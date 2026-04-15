import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { connectUpstream } from "./upstream-client.js";
import { ProxySession } from "./message-interceptor.js";
import type { LogEngine } from "../logging/log-engine.js";
import type { UpstreamConfig, IdentityConfig } from "../types.js";

export interface MultiplexOptions {
  upstreams: UpstreamConfig[];
  logEngine: LogEngine;
  identity?: IdentityConfig;
}

interface UpstreamEntry {
  name: string;
  client: Awaited<ReturnType<typeof connectUpstream>>;
  session: ProxySession;
}

/**
 * Multi-upstream stdio proxy. Connects to N upstream MCP servers and
 * exposes a single MCP server to the host whose tool list is the union
 * of all upstreams. Tool names are prefixed with `${serverName}__` so
 * callers can disambiguate; tool calls are routed back to the right
 * upstream by parsing the prefix.
 */
export async function runMultiplexStdioProxy(
  opts: MultiplexOptions,
): Promise<{ close: () => Promise<void> }> {
  const entries: UpstreamEntry[] = [];
  for (const upstream of opts.upstreams) {
    const client = await connectUpstream(upstream);
    const session = new ProxySession(
      upstream.name,
      opts.logEngine,
      opts.identity,
    );
    entries.push({ name: upstream.name, client, session });
  }

  const server = new Server(
    { name: "mcpaudit-multiplex", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Array<Record<string, unknown>> = [];
    for (const e of entries) {
      const result = await e.session.recordCall(
        "tools/list",
        "*",
        {},
        () => e.client.listTools(),
      );
      for (const t of result.tools) {
        tools.push({
          ...t,
          name: `${e.name}__${t.name}`,
          description: `[${e.name}] ${t.description ?? ""}`.trim(),
        });
      }
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { entry, bareName } = routeByPrefix(entries, req.params.name);
    return entry.session.recordCall(
      "tools/call",
      bareName,
      req.params.arguments ?? {},
      () =>
        entry.client.callTool({
          name: bareName,
          arguments: req.params.arguments,
        }),
    );
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Array<Record<string, unknown>> = [];
    for (const e of entries) {
      try {
        const result = await e.session.recordCall(
          "resources/list",
          "*",
          {},
          () => e.client.listResources(),
        );
        for (const r of result.resources ?? []) {
          resources.push({
            ...r,
            uri: `${e.name}://${r.uri}`,
          });
        }
      } catch {
        // upstream may not support resources; skip
      }
    }
    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const { entry, bareName } = routeResource(entries, req.params.uri);
    return entry.session.recordCall(
      "resources/read",
      bareName,
      { uri: bareName },
      () => entry.client.readResource({ uri: bareName }),
    );
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const prompts: Array<Record<string, unknown>> = [];
    for (const e of entries) {
      try {
        const result = await e.session.recordCall(
          "prompts/list",
          "*",
          {},
          () => e.client.listPrompts(),
        );
        for (const p of result.prompts ?? []) {
          prompts.push({ ...p, name: `${e.name}__${p.name}` });
        }
      } catch {}
    }
    return { prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { entry, bareName } = routeByPrefix(entries, req.params.name);
    return entry.session.recordCall(
      "prompts/get",
      bareName,
      req.params.arguments ?? {},
      () =>
        entry.client.getPrompt({
          name: bareName,
          arguments: req.params.arguments,
        }),
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    close: async () => {
      try {
        await server.close();
      } catch {}
      for (const e of entries) {
        try {
          await e.client.close();
        } catch {}
      }
    },
  };
}

function routeByPrefix(
  entries: UpstreamEntry[],
  prefixedName: string,
): { entry: UpstreamEntry; bareName: string } {
  const sep = prefixedName.indexOf("__");
  if (sep < 0) {
    throw new Error(
      `tool name "${prefixedName}" missing upstream prefix (expected name__tool)`,
    );
  }
  const prefix = prefixedName.slice(0, sep);
  const bareName = prefixedName.slice(sep + 2);
  const entry = entries.find((e) => e.name === prefix);
  if (!entry) throw new Error(`unknown upstream: ${prefix}`);
  return { entry, bareName };
}

function routeResource(
  entries: UpstreamEntry[],
  prefixedUri: string,
): { entry: UpstreamEntry; bareName: string } {
  const m = /^([^:]+):\/\/(.*)$/.exec(prefixedUri);
  if (!m) throw new Error(`resource uri "${prefixedUri}" missing upstream scheme`);
  const entry = entries.find((e) => e.name === m[1]);
  if (!entry) throw new Error(`unknown upstream scheme: ${m[1]}`);
  return { entry, bareName: m[2] };
}
