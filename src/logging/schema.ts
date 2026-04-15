/**
 * Structured audit log record for a single MCP interaction.
 * Written append-only; hash-chained for tamper evidence.
 */
export interface AuditRecord {
  id: string;
  correlationId: string;
  sessionId: string;

  serverName: string;
  toolName: string;
  method: string;
  inputParams: unknown;
  outputData: unknown;
  isError: boolean;
  errorMessage?: string;

  startedAt: string;
  completedAt: string;
  latencyMs: number;

  userIdentity?: string;
  clientInfo?: Record<string, unknown>;
  estimatedCostUsd?: number;

  contentHash: string;
  previousHash?: string;
}

/**
 * Lightweight record for non-call events (initialize, list, notifications, ...).
 * Uses the same table but with a different `method` and often empty output.
 */
export interface EventRecord extends AuditRecord {
  eventKind: "initialize" | "list" | "read" | "notification" | "progress";
}

export const RECORD_COLUMNS = [
  "id",
  "correlation_id",
  "session_id",
  "server_name",
  "tool_name",
  "method",
  "input_params",
  "output_data",
  "is_error",
  "error_message",
  "started_at",
  "completed_at",
  "latency_ms",
  "user_identity",
  "client_info",
  "estimated_cost_usd",
  "content_hash",
  "previous_hash",
] as const;

export type DbRow = {
  id: string;
  correlation_id: string;
  session_id: string;
  server_name: string;
  tool_name: string;
  method: string;
  input_params: string;
  output_data: string;
  is_error: number;
  error_message: string | null;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  user_identity: string | null;
  client_info: string | null;
  estimated_cost_usd: number | null;
  content_hash: string;
  previous_hash: string | null;
};

export function recordToRow(r: AuditRecord): DbRow {
  return {
    id: r.id,
    correlation_id: r.correlationId,
    session_id: r.sessionId,
    server_name: r.serverName,
    tool_name: r.toolName,
    method: r.method,
    input_params: JSON.stringify(r.inputParams ?? null),
    output_data: JSON.stringify(r.outputData ?? null),
    is_error: r.isError ? 1 : 0,
    error_message: r.errorMessage ?? null,
    started_at: r.startedAt,
    completed_at: r.completedAt,
    latency_ms: r.latencyMs,
    user_identity: r.userIdentity ?? null,
    client_info: r.clientInfo ? JSON.stringify(r.clientInfo) : null,
    estimated_cost_usd: r.estimatedCostUsd ?? null,
    content_hash: r.contentHash,
    previous_hash: r.previousHash ?? null,
  };
}

export function rowToRecord(row: DbRow): AuditRecord {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    sessionId: row.session_id,
    serverName: row.server_name,
    toolName: row.tool_name,
    method: row.method,
    inputParams: safeJsonParse(row.input_params),
    outputData: safeJsonParse(row.output_data),
    isError: row.is_error === 1,
    errorMessage: row.error_message ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    latencyMs: row.latency_ms,
    userIdentity: row.user_identity ?? undefined,
    clientInfo: row.client_info
      ? (safeJsonParse(row.client_info) as Record<string, unknown>)
      : undefined,
    estimatedCostUsd: row.estimated_cost_usd ?? undefined,
    contentHash: row.content_hash,
    previousHash: row.previous_hash ?? undefined,
  };
}

function safeJsonParse(s: string | null): unknown {
  if (s == null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
