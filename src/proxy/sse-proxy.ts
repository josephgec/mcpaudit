import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { connectUpstream } from "./upstream-client.js";
import { ProxySession } from "./message-interceptor.js";
import { wireHandlers } from "./handlers.js";
import type { LogEngine } from "../logging/log-engine.js";
import type {
  IdentityConfig,
  ProxyConfig,
  UpstreamConfig,
} from "../types.js";

export interface SseProxyOptions {
  proxy: ProxyConfig;
  upstream: UpstreamConfig;
  logEngine: LogEngine;
  identity?: IdentityConfig;
}

/**
 * Runs an MCP proxy over HTTP+SSE: one persistent /sse endpoint for
 * server->client messages, and POST /message for client->server JSON-RPC.
 * Each incoming SSE connection spawns its own upstream client and session.
 */
export async function runSseProxy(
  opts: SseProxyOptions,
): Promise<{ close: () => Promise<void> }> {
  const host = opts.proxy.listen?.host ?? "127.0.0.1";
  const port = opts.proxy.listen?.port ?? 3100;

  // sessionId -> { transport, server, upstreamClient }
  const sessions = new Map<
    string,
    {
      transport: SSEServerTransport;
      server: Server;
      upstream: Awaited<ReturnType<typeof connectUpstream>>;
    }
  >();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!req.url) return notFound(res);

      if (req.method === "GET" && req.url.startsWith("/sse")) {
        const upstream = await connectUpstream(opts.upstream);
        const upstreamInfo = upstream.getServerVersion() ?? {
          name: opts.upstream.name,
          version: "unknown",
        };
        const caps = upstream.getServerCapabilities() ?? {};
        const server = new Server(
          {
            name: `mcpaudit(${upstreamInfo.name})`,
            version: upstreamInfo.version,
          },
          { capabilities: caps },
        );
        const session = new ProxySession(
          opts.upstream.name,
          opts.logEngine,
          opts.identity,
        );
        // Identify user from header if configured.
        if (opts.identity?.source === "header") {
          const h = opts.identity.header_name ?? "x-user-id";
          const val = req.headers[h.toLowerCase()];
          if (typeof val === "string") session.userIdentity = val;
        }
        wireHandlers(server, upstream, session, caps);

        const transport = new SSEServerTransport("/message", res);
        sessions.set(transport.sessionId, { transport, server, upstream });
        res.on("close", async () => {
          sessions.delete(transport.sessionId);
          try {
            await server.close();
          } catch {}
          try {
            await upstream.close();
          } catch {}
        });
        await server.connect(transport);
        return;
      }

      if (req.method === "POST" && req.url.startsWith("/message")) {
        const url = new URL(req.url, `http://${host}:${port}`);
        const sid = url.searchParams.get("sessionId");
        if (!sid || !sessions.has(sid)) {
          res.writeHead(404).end("no session");
          return;
        }
        const entry = sessions.get(sid)!;
        await entry.transport.handlePostMessage(req, res);
        return;
      }

      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
        return;
      }

      notFound(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("proxy error: " + msg);
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));

  return {
    close: async () => {
      for (const { server, upstream } of sessions.values()) {
        try {
          await server.close();
        } catch {}
        try {
          await upstream.close();
        } catch {}
      }
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

function notFound(res: http.ServerResponse) {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}
