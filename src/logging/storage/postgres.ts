import pg from "pg";
import {
  recordToRow,
  rowToRecord,
  type AuditRecord,
  type DbRow,
} from "../schema.js";
import type {
  QueryFilter,
  StatsResult,
  Storage,
} from "./interface.js";

export interface PostgresOptions {
  connectionString: string;
  schema?: string;
  poolSize?: number;
}

const DDL = (schema: string) => `
CREATE SCHEMA IF NOT EXISTS ${schema};
CREATE TABLE IF NOT EXISTS ${schema}.audit_log (
  id               TEXT PRIMARY KEY,
  correlation_id   TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  server_name      TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  method           TEXT NOT NULL,
  input_params     JSONB NOT NULL,
  output_data      JSONB NOT NULL,
  is_error         BOOLEAN NOT NULL DEFAULT FALSE,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ NOT NULL,
  latency_ms       INTEGER NOT NULL,
  user_identity    TEXT,
  client_info      JSONB,
  estimated_cost_usd NUMERIC,
  content_hash     TEXT NOT NULL,
  previous_hash    TEXT,
  inserted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_started_at_idx ON ${schema}.audit_log (started_at);
CREATE INDEX IF NOT EXISTS audit_session_idx    ON ${schema}.audit_log (session_id);
CREATE INDEX IF NOT EXISTS audit_corr_idx       ON ${schema}.audit_log (correlation_id);
CREATE INDEX IF NOT EXISTS audit_server_idx     ON ${schema}.audit_log (server_name);
CREATE INDEX IF NOT EXISTS audit_tool_idx       ON ${schema}.audit_log (tool_name);
CREATE INDEX IF NOT EXISTS audit_error_idx      ON ${schema}.audit_log (is_error);
`;

const REVOKE_DDL = (schema: string) => `
-- Enforce append-only at the role level; application role must not own the table.
REVOKE UPDATE, DELETE ON ${schema}.audit_log FROM PUBLIC;
`;

/**
 * PostgreSQL storage backend. Uses JSONB columns for structured payloads
 * and enforces append-only semantics at the application layer. Production
 * deployments should additionally revoke UPDATE/DELETE from the app role.
 */
export class PostgresStorage implements Storage {
  private pool: pg.Pool;
  private schema: string;
  private lastHashCache: string | undefined;

  constructor(opts: PostgresOptions) {
    this.schema = opts.schema ?? "mcpaudit";
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      max: opts.poolSize ?? 10,
    });
  }

  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(DDL(this.schema));
      // Best-effort, ignore if role lacks permission.
      try {
        await client.query(REVOKE_DDL(this.schema));
      } catch {}
    } finally {
      client.release();
    }
  }

  async append(record: AuditRecord): Promise<void> {
    const row = recordToRow(record);
    const sql = `INSERT INTO ${this.schema}.audit_log
      (id, correlation_id, session_id, server_name, tool_name, method,
       input_params, output_data, is_error, error_message,
       started_at, completed_at, latency_ms,
       user_identity, client_info, estimated_cost_usd,
       content_hash, previous_hash)
      VALUES
      ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)`;
    const values = [
      row.id,
      row.correlation_id,
      row.session_id,
      row.server_name,
      row.tool_name,
      row.method,
      row.input_params,
      row.output_data,
      row.is_error === 1,
      row.error_message,
      row.started_at,
      row.completed_at,
      row.latency_ms,
      row.user_identity,
      row.client_info,
      row.estimated_cost_usd,
      row.content_hash,
      row.previous_hash,
    ];
    await this.pool.query(sql, values);
    this.lastHashCache = record.contentHash;
  }

  async getLastHash(): Promise<string | undefined> {
    if (this.lastHashCache) return this.lastHashCache;
    const r = await this.pool.query<{ content_hash: string }>(
      `SELECT content_hash FROM ${this.schema}.audit_log
       ORDER BY started_at DESC, id DESC LIMIT 1`,
    );
    this.lastHashCache = r.rows[0]?.content_hash;
    return this.lastHashCache;
  }

  async query(filter: QueryFilter): Promise<AuditRecord[]> {
    const { where, values } = buildWhere(filter);
    const limit = Math.min(1_000_000, filter.limit ?? 500);
    const offset = filter.offset ?? 0;
    const sql = `SELECT * FROM ${this.schema}.audit_log${
      where ? " WHERE " + where : ""
    } ORDER BY started_at ASC, id ASC LIMIT ${limit} OFFSET ${offset}`;
    const r = await this.pool.query(sql, values);
    return r.rows.map((raw) => rowToRecord(normalize(raw)));
  }

  async count(filter: QueryFilter): Promise<number> {
    const { where, values } = buildWhere(filter);
    const sql = `SELECT COUNT(*)::bigint AS c FROM ${this.schema}.audit_log${
      where ? " WHERE " + where : ""
    }`;
    const r = await this.pool.query(sql, values);
    return Number(r.rows[0]?.c ?? 0);
  }

  async stats(filter: QueryFilter): Promise<StatsResult> {
    const records = await this.query({ ...filter, limit: 100_000 });
    const total = records.length;
    const errors = records.filter((r) => r.isError).length;
    const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p = (q: number) =>
      latencies.length === 0
        ? 0
        : latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))];
    const tools = new Map<string, number>();
    const servers = new Map<string, number>();
    for (const r of records) {
      tools.set(r.toolName, (tools.get(r.toolName) ?? 0) + 1);
      servers.set(r.serverName, (servers.get(r.serverName) ?? 0) + 1);
    }
    return {
      totalCalls: total,
      errorCount: errors,
      errorRate: total === 0 ? 0 : errors / total,
      p50LatencyMs: p(0.5),
      p95LatencyMs: p(0.95),
      p99LatencyMs: p(0.99),
      topTools: [...tools.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tool, count]) => ({ tool, count })),
      topServers: [...servers.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([server, count]) => ({ server, count })),
    };
  }

  async purgeOlderThan(olderThan: string): Promise<number> {
    // Retention deletion is the ONLY allowed mutation. Application must
    // hold an elevated role; otherwise the REVOKE in init() will block.
    const sql = `DELETE FROM ${this.schema}.audit_log WHERE started_at < $1`;
    const r = await this.pool.query(sql, [olderThan]);
    return r.rowCount ?? 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function buildWhere(filter: QueryFilter): {
  where: string;
  values: unknown[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const ph = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  if (filter.from) clauses.push(`started_at >= ${ph(filter.from)}`);
  if (filter.to) clauses.push(`started_at <= ${ph(filter.to)}`);
  if (filter.serverName) clauses.push(`server_name = ${ph(filter.serverName)}`);
  if (filter.toolName) clauses.push(`tool_name = ${ph(filter.toolName)}`);
  if (filter.sessionId) clauses.push(`session_id = ${ph(filter.sessionId)}`);
  if (filter.correlationId)
    clauses.push(`correlation_id = ${ph(filter.correlationId)}`);
  if (typeof filter.isError === "boolean")
    clauses.push(`is_error = ${ph(filter.isError)}`);
  if (filter.search) {
    const needle = `%${filter.search}%`;
    const a = ph(needle);
    const b = ph(needle);
    const c = ph(needle);
    clauses.push(
      `(tool_name ILIKE ${a} OR input_params::text ILIKE ${b} OR output_data::text ILIKE ${c})`,
    );
  }
  return { where: clauses.join(" AND "), values };
}

type RawRow = {
  id: string;
  correlation_id: string;
  session_id: string;
  server_name: string;
  tool_name: string;
  method: string;
  input_params: unknown;
  output_data: unknown;
  is_error: boolean;
  error_message: string | null;
  started_at: Date | string;
  completed_at: Date | string;
  latency_ms: number;
  user_identity: string | null;
  client_info: unknown;
  estimated_cost_usd: string | number | null;
  content_hash: string;
  previous_hash: string | null;
};

function normalize(raw: RawRow): DbRow {
  return {
    id: raw.id,
    correlation_id: raw.correlation_id,
    session_id: raw.session_id,
    server_name: raw.server_name,
    tool_name: raw.tool_name,
    method: raw.method,
    input_params:
      typeof raw.input_params === "string"
        ? raw.input_params
        : JSON.stringify(raw.input_params ?? null),
    output_data:
      typeof raw.output_data === "string"
        ? raw.output_data
        : JSON.stringify(raw.output_data ?? null),
    is_error: raw.is_error ? 1 : 0,
    error_message: raw.error_message,
    started_at:
      raw.started_at instanceof Date
        ? raw.started_at.toISOString()
        : raw.started_at,
    completed_at:
      raw.completed_at instanceof Date
        ? raw.completed_at.toISOString()
        : raw.completed_at,
    latency_ms: raw.latency_ms,
    user_identity: raw.user_identity,
    client_info:
      raw.client_info == null
        ? null
        : typeof raw.client_info === "string"
          ? raw.client_info
          : JSON.stringify(raw.client_info),
    estimated_cost_usd:
      raw.estimated_cost_usd == null
        ? null
        : typeof raw.estimated_cost_usd === "string"
          ? parseFloat(raw.estimated_cost_usd)
          : raw.estimated_cost_usd,
    content_hash: raw.content_hash,
    previous_hash: raw.previous_hash,
  };
}
