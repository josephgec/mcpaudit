import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { UpstreamConfig } from "../types.js";
import { isStdioUpstream } from "../types.js";

/**
 * Connects a single upstream MCP server and returns an initialized Client.
 * Supports both stdio (spawned subprocess) and remote SSE transports.
 */
export async function connectUpstream(
  upstream: UpstreamConfig,
): Promise<Client> {
  const client = new Client(
    { name: "mcpaudit-proxy", version: "0.1.0" },
    { capabilities: {} },
  );

  if (isStdioUpstream(upstream)) {
    const transport = new StdioClientTransport({
      command: upstream.command,
      args: upstream.args ?? [],
      env: { ...process.env, ...(upstream.env ?? {}) } as Record<string, string>,
    });
    await client.connect(transport);
  } else {
    const url = new URL(upstream.url);
    const transport = new SSEClientTransport(url, {
      requestInit: upstream.headers
        ? { headers: upstream.headers }
        : undefined,
    });
    await client.connect(transport);
  }

  return client;
}
