import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ProxySession } from "./message-interceptor.js";

/**
 * Registers request handlers on the proxy-side Server that forward each
 * request to the upstream Client, while recording a log entry via the
 * ProxySession. One registration per supported MCP method.
 */
export function wireHandlers(
  server: Server,
  upstream: Client,
  session: ProxySession,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    return session.recordCall(
      "tools/list",
      "*",
      req.params ?? {},
      () => upstream.listTools(req.params),
    );
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    return session.recordCall("tools/call", name, args ?? {}, () =>
      upstream.callTool({ name, arguments: args }),
    );
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (req) => {
    return session.recordCall(
      "resources/list",
      "*",
      req.params ?? {},
      () => upstream.listResources(req.params),
    );
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req) => {
    return session.recordCall(
      "resources/templates/list",
      "*",
      req.params ?? {},
      () => upstream.listResourceTemplates(req.params),
    );
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return session.recordCall(
      "resources/read",
      req.params.uri,
      req.params,
      () => upstream.readResource(req.params),
    );
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (req) => {
    return session.recordCall(
      "prompts/list",
      "*",
      req.params ?? {},
      () => upstream.listPrompts(req.params),
    );
  });

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    return session.recordCall(
      "prompts/get",
      req.params.name,
      req.params,
      () => upstream.getPrompt(req.params),
    );
  });

  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    return session.recordCall(
      "completion/complete",
      "*",
      req.params,
      () => upstream.complete(req.params),
    );
  });
}
