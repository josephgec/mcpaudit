import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname } from "node:path";
import type { LogEngine } from "../logging/log-engine.js";
import type { Config } from "../types.js";
import type { AuditRecord } from "../logging/schema.js";
import { authenticate, requireRole, type AuthContext } from "./auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface DashboardHandle {
  close: () => Promise<void>;
}

export async function startDashboard(
  engine: LogEngine,
  cfg: Config,
): Promise<DashboardHandle> {
  const host = cfg.dashboard?.host ?? "127.0.0.1";
  const port = cfg.dashboard?.port ?? 3101;

  // SSE subscribers receive each newly-appended record.
  const subs = new Set<http.ServerResponse>();
  engine.onAppend((r) => {
    const payload = `data: ${JSON.stringify(r)}\n\n`;
    for (const res of subs) {
      try {
        res.write(payload);
      } catch {
        subs.delete(res);
      }
    }
  });

  const uiRoot = resolveUiRoot();

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) return notFound(res);
      const url = new URL(req.url, `http://${host}:${port}`);

      // Health check — never auth-gated.
      if (url.pathname === "/healthz") {
        return json(res, 200, { ok: true });
      }

      // Authenticate for any /api or /dashboard route if auth is enabled.
      const auth = authenticate(req, cfg.dashboard);
      if (auth.required && !auth.ok) {
        res.writeHead(401, {
          "www-authenticate": 'Basic realm="mcpaudit"',
        });
        res.end("unauthorized");
        return;
      }

      if (url.pathname === "/api/records") {
        requireRole(auth, ["admin", "auditor", "viewer"]);
        const filter = parseFilter(url.searchParams);
        const records = await Promise.resolve(
          engine.storageRef.query(filter),
        );
        return json(res, 200, { records });
      }

      if (url.pathname === "/api/stats") {
        requireRole(auth, ["admin", "auditor", "viewer"]);
        const filter = parseFilter(url.searchParams);
        const stats = await Promise.resolve(engine.storageRef.stats(filter));
        return json(res, 200, stats);
      }

      if (url.pathname === "/api/record" && url.searchParams.get("id")) {
        requireRole(auth, ["admin", "auditor"]);
        const id = url.searchParams.get("id")!;
        const rows = await Promise.resolve(
          engine.storageRef.query({ limit: 1, search: id }),
        );
        const match = rows.find((r) => r.id === id);
        return json(res, 200, { record: match ?? null });
      }

      if (url.pathname === "/api/session" && url.searchParams.get("id")) {
        requireRole(auth, ["admin", "auditor", "viewer"]);
        const id = url.searchParams.get("id")!;
        const records = await Promise.resolve(
          engine.storageRef.query({ sessionId: id, limit: 10_000 }),
        );
        return json(res, 200, { records });
      }

      if (url.pathname === "/api/live") {
        requireRole(auth, ["admin", "auditor", "viewer"]);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        subs.add(res);
        req.on("close", () => subs.delete(res));
        return;
      }

      // Static UI serving — fall through to index.html for SPA routes.
      if (uiRoot) {
        const served = tryServeStatic(uiRoot, url.pathname, res);
        if (served) return;
        const indexPath = join(uiRoot, "index.html");
        if (existsSync(indexPath)) {
          const html = readFileSync(indexPath, "utf8");
          res.writeHead(200, { "content-type": "text/html" });
          res.end(html);
          return;
        }
      }

      // Fallback: minimal embedded dashboard (works even without a build step).
      if (url.pathname === "/" || url.pathname === "/dashboard") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(EMBEDDED_HTML);
        return;
      }

      notFound(res);
    } catch (e) {
      if (e instanceof DashboardAuthError) {
        res.writeHead(403);
        res.end(e.message);
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("dashboard error: " + msg);
    }
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  return {
    close: async () => {
      for (const r of subs) {
        try {
          r.end();
        } catch {}
      }
      subs.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export class DashboardAuthError extends Error {}

function parseFilter(params: URLSearchParams): {
  from?: string;
  to?: string;
  serverName?: string;
  toolName?: string;
  sessionId?: string;
  correlationId?: string;
  isError?: boolean;
  limit: number;
  search?: string;
} {
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    serverName: params.get("server") ?? undefined,
    toolName: params.get("tool") ?? undefined,
    sessionId: params.get("sessionId") ?? undefined,
    correlationId: params.get("correlationId") ?? undefined,
    isError:
      params.get("error") === "true"
        ? true
        : params.get("error") === "false"
          ? false
          : undefined,
    limit: parseInt(params.get("limit") ?? "500", 10),
    search: params.get("q") ?? undefined,
  };
}

function resolveUiRoot(): string | undefined {
  // Look for a built UI bundle next to the compiled server file.
  const candidates = [
    join(__dirname, "ui"),
    join(__dirname, "..", "..", "dist", "dashboard", "ui"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return undefined;
}

function tryServeStatic(
  root: string,
  pathname: string,
  res: http.ServerResponse,
): boolean {
  if (pathname.includes("..")) return false;
  const file = join(root, pathname === "/" ? "/index.html" : pathname);
  if (!existsSync(file)) return false;
  const buf = readFileSync(file);
  res.writeHead(200, { "content-type": mimeFor(file) });
  res.end(buf);
  return true;
}

function mimeFor(file: string): string {
  const ext = extname(file).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
      return "application/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

const EMBEDDED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>mcpaudit</title>
<style>
  :root { color-scheme: dark; --bg:#0b0e14; --fg:#e6edf3; --muted:#7d8590; --accent:#58a6ff; --err:#f85149; --ok:#3fb950; --card:#161b22; --border:#30363d; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--fg); }
  header { padding:12px 20px; border-bottom:1px solid var(--border); display:flex; gap:16px; align-items:center; }
  header h1 { margin:0; font-size:16px; font-weight:600; }
  header .muted { color:var(--muted); font-size:12px; }
  main { display:grid; grid-template-columns: 1fr 2fr; gap:16px; padding:16px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:6px; padding:12px; }
  .card h2 { margin:0 0 10px; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .stat { display:flex; justify-content:space-between; padding:4px 0; font-size:13px; }
  .stat .v { color:var(--accent); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--border); }
  th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; }
  tr:hover { background:#1f2730; }
  .ok { color:var(--ok); } .err { color:var(--err); }
  .feed { max-height: 80vh; overflow-y:auto; }
  input { width:100%; background:#0d1117; color:var(--fg); border:1px solid var(--border); padding:6px 8px; border-radius:4px; font-family:inherit; }
</style>
</head>
<body>
<header>
  <h1>mcpaudit</h1>
  <span class="muted" id="status">connecting…</span>
</header>
<main>
  <section class="card">
    <h2>Summary (last 24h)</h2>
    <div id="stats"></div>
    <h2 style="margin-top:16px">Top tools</h2>
    <div id="tools"></div>
    <h2 style="margin-top:16px">Top servers</h2>
    <div id="servers"></div>
  </section>
  <section class="card">
    <h2>Live feed</h2>
    <input id="q" placeholder="search tool, session, ID..."/>
    <div class="feed">
      <table id="feed">
        <thead><tr><th>Time</th><th>Server</th><th>Tool</th><th>Latency</th><th>Status</th><th>Session</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
  </section>
</main>
<script>
const feedBody = document.querySelector('#feed tbody');
const statsEl = document.querySelector('#stats');
const toolsEl = document.querySelector('#tools');
const serversEl = document.querySelector('#servers');
const statusEl = document.querySelector('#status');
const qEl = document.querySelector('#q');
let all = [];
let filter = '';

function renderStats(s) {
  statsEl.innerHTML = '' +
    row('Total calls', s.totalCalls) +
    row('Errors', s.errorCount + ' (' + (s.errorRate*100).toFixed(1) + '%)') +
    row('p50 latency', s.p50LatencyMs + 'ms') +
    row('p95 latency', s.p95LatencyMs + 'ms') +
    row('p99 latency', s.p99LatencyMs + 'ms');
  toolsEl.innerHTML = s.topTools.map(t => row(t.tool, t.count)).join('');
  serversEl.innerHTML = s.topServers.map(t => row(t.server, t.count)).join('');
}
function row(k,v){ return '<div class="stat"><span>'+esc(k)+'</span><span class="v">'+esc(v)+'</span></div>'; }
function esc(v){ return String(v).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

function matches(r, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return (r.toolName||'').toLowerCase().includes(q)
    || (r.serverName||'').toLowerCase().includes(q)
    || (r.sessionId||'').toLowerCase().includes(q)
    || (r.id||'').toLowerCase().includes(q);
}
function renderFeed() {
  const rows = all.filter(r => matches(r, filter)).slice(-200).reverse();
  feedBody.innerHTML = rows.map(r => '<tr>' +
    '<td>' + r.startedAt.slice(11,19) + '</td>' +
    '<td>' + esc(r.serverName) + '</td>' +
    '<td>' + esc(r.toolName) + '</td>' +
    '<td>' + r.latencyMs + 'ms</td>' +
    '<td class="' + (r.isError ? 'err' : 'ok') + '">' + (r.isError ? 'ERR' : 'OK') + '</td>' +
    '<td>' + esc((r.sessionId||'').slice(-8)) + '</td>' +
  '</tr>').join('');
}
qEl.addEventListener('input', () => { filter = qEl.value; renderFeed(); });

async function loadStats(){
  try{
    const from = new Date(Date.now() - 24*3600*1000).toISOString();
    const s = await fetch('/api/stats?from=' + from).then(r=>r.json());
    renderStats(s);
  }catch(e){ statusEl.textContent = 'stats error'; }
}
async function loadInitial(){
  try{
    const r = await fetch('/api/records?limit=200').then(r=>r.json());
    all = r.records || [];
    renderFeed();
  }catch(e){}
}
function connectLive(){
  const es = new EventSource('/api/live');
  es.onopen = () => statusEl.textContent = 'live';
  es.onerror = () => statusEl.textContent = 'disconnected';
  es.onmessage = (ev) => {
    try {
      const r = JSON.parse(ev.data);
      all.push(r);
      if (all.length > 2000) all = all.slice(-2000);
      renderFeed();
    } catch {}
  };
}
loadStats(); loadInitial(); connectLive();
setInterval(loadStats, 30000);
</script>
</body>
</html>`;
