import { loadConfig } from "../config.js";
import { buildStorage } from "../bootstrap.js";

export interface StatsOptions {
  config: string;
  last?: string; // "24h", "7d", "30d"
  server?: string;
  tool?: string;
  json?: boolean;
}

export async function runStats(opts: StatsOptions): Promise<void> {
  const cfg = loadConfig(opts.config);
  const storage = await buildStorage(cfg);

  const from = opts.last ? subtract(new Date(), opts.last) : undefined;
  const filter = {
    from: from?.toISOString(),
    serverName: opts.server,
    toolName: opts.tool,
  };
  const s = await Promise.resolve(storage.stats(filter));
  await Promise.resolve(storage.close());

  if (opts.json) {
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return;
  }

  const out = [
    `Total calls:   ${s.totalCalls}`,
    `Errors:        ${s.errorCount} (${(s.errorRate * 100).toFixed(2)}%)`,
    `Latency p50:   ${s.p50LatencyMs}ms`,
    `Latency p95:   ${s.p95LatencyMs}ms`,
    `Latency p99:   ${s.p99LatencyMs}ms`,
    ``,
    `Top tools:`,
    ...s.topTools.map((t) => `  ${t.count.toString().padStart(6)}  ${t.tool}`),
    ``,
    `Top servers:`,
    ...s.topServers.map(
      (t) => `  ${t.count.toString().padStart(6)}  ${t.server}`,
    ),
  ].join("\n");
  process.stdout.write(out + "\n");
}

function subtract(now: Date, span: string): Date {
  const m = /^(\d+)([hdw])$/.exec(span);
  if (!m) throw new Error(`invalid --last: ${span} (use e.g. 24h, 7d)`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = unit === "h" ? 3600e3 : unit === "d" ? 86400e3 : 7 * 86400e3;
  return new Date(now.getTime() - n * mult);
}
