import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectUpstream } from "./upstream-client.js";
import { ProxySession } from "./message-interceptor.js";
import { wireHandlers } from "./handlers.js";
import type { LogEngine } from "../logging/log-engine.js";
import type { UpstreamConfig, IdentityConfig } from "../types.js";

export interface StdioProxyOptions {
  upstream: UpstreamConfig;
  logEngine: LogEngine;
  identity?: IdentityConfig;
}

/**
 * Runs a transparent MCP proxy that accepts a single stdio client
 * (the AI host) and forwards all requests to an upstream MCP server.
 * Every request is logged via the LogEngine.
 */
export async function runStdioProxy(
  opts: StdioProxyOptions,
): Promise<{ close: () => Promise<void> }> {
  const upstreamClient = await connectUpstream(opts.upstream);

  // Mirror the upstream's advertised server info + capabilities so the host
  // sees the proxy as indistinguishable from the real server.
  const upstreamInfo = upstreamClient.getServerVersion() ?? {
    name: opts.upstream.name,
    version: "unknown",
  };
  const caps = upstreamClient.getServerCapabilities() ?? {};

  const server = new Server(
    { name: `mcpaudit(${upstreamInfo.name})`, version: upstreamInfo.version },
    { capabilities: caps },
  );

  const session = new ProxySession(
    opts.upstream.name,
    opts.logEngine,
    opts.identity,
  );

  wireHandlers(server, upstreamClient, session, caps);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    close: async () => {
      try {
        await server.close();
      } catch {}
      try {
        await upstreamClient.close();
      } catch {}
    },
  };
}
