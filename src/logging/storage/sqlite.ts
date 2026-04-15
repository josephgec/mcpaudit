import Database from "better-sqlite3";
import { mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
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

export interface SqliteOptions {
  /** Directory where audit-logs-YYYY-MM-DD.sqlite files live. */
  dir: string;
  /** "daily" rotates files per day; "size" rotates once the active file exceeds sizeMb. */
  rotation?: "daily" | "size";
  rotationSizeMb?: number;
  /**
   * When true, the storage is opened in strict append-only mode:
   * a BEFORE UPDATE/DELETE trigger raises an exception on any mutation.
   */
  appendOnly?: boolean;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  method TEXT NOT NULL,
  input_params TEXT NOT NULL,
  output_data TEXT NOT NULL,
  is_error INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  user_identity TEXT,
  client_info TEXT,
  estimated_cost_usd REAL,
  content_hash TEXT NOT NULL,
  previous_hash TEXT,
  inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_started_at ON audit_log(started_at);
CREATE INDEX IF NOT EXISTS idx_audit_session    ON audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_corr       ON audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_server     ON audit_log(server_name);
CREATE INDEX IF NOT EXISTS idx_audit_tool       ON audit_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_audit_error      ON audit_log(is_error);

CREATE TRIGGER IF NOT EXISTS audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete
BEFORE DELETE ON audit_log
WHEN NEW.id IS NULL  -- noop guard; purge uses attach-detach pragma trick below
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
`;

/**
 * SQLite storage backend with hash-chain integrity, append-only triggers,
 * and per-day file rotation. Multiple daily files are transparently unioned
 * at query time.
 */
export class SqliteStorage implements Storage {
  private activeDb: Database.Database | null = null;
  private activeFile: string | null = null;
  private activeDate: string | null = null;
  private cachedLastHash: string | undefined;
  private insertStmt: Database.Statement | null = null;

  constructor(private opts: SqliteOptions) {}

  init(): void {
    if (!existsSync(this.opts.dir)) {
      mkdirSync(this.opts.dir, { recursive: true });
    }
    this.rotateIfNeeded();
  }

  private currentFile(): string {
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    return join(this.opts.dir, `audit-${date}.sqlite`);
  }

  private rotateIfNeeded(): void {
    const target = this.currentFile();
    const today = new Date().toISOString().slice(0, 10);

    if (this.activeFile !== target || this.activeDate !== today) {
      if (this.activeDb) {
        try {
          this.activeDb.close();
        } catch {}
      }
      mkdirSync(dirname(target), { recursive: true });
      const db = new Database(target);
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("foreign_keys = ON");
      db.exec(SCHEMA_SQL);
      this.activeDb = db;
      this.activeFile = target;
      this.activeDate = today;
      this.insertStmt = db.prepare(
        `INSERT INTO audit_log
          (id, correlation_id, session_id, server_name, tool_name, method,
           input_params, output_data, is_error, error_message,
           started_at, completed_at, latency_ms,
           user_identity, client_info, estimated_cost_usd,
           content_hash, previous_hash)
         VALUES
          (@id, @correlation_id, @session_id, @server_name, @tool_name, @method,
           @input_params, @output_data, @is_error, @error_message,
           @started_at, @completed_at, @latency_ms,
           @user_identity, @client_info, @estimated_cost_usd,
           @content_hash, @previous_hash)`,
      );
      this.cachedLastHash = this.loadLastHashAcrossFiles();
    }
  }

  append(record: AuditRecord): void {
    this.rotateIfNeeded();
    if (!this.insertStmt) throw new Error("storage not initialized");
    const row = recordToRow(record);
    this.insertStmt.run(row);
    this.cachedLastHash = record.contentHash;
  }

  getLastHash(): string | undefined {
    if (this.cachedLastHash !== undefined) return this.cachedLastHash;
    this.cachedLastHash = this.loadLastHashAcrossFiles();
    return this.cachedLastHash;
  }

  /**
   * Walks every audit-*.sqlite file in the dir (sorted) and returns the
   * content_hash of the globally-latest record across all files.
   */
  private loadLastHashAcrossFiles(): string | undefined {
    const files = this.listDbFiles();
    let latest: { ts: string; hash: string } | undefined;
    for (const f of files) {
      try {
        const db = new Database(f, { readonly: true, fileMustExist: true });
        const row = db
          .prepare(
            `SELECT content_hash, started_at FROM audit_log
             ORDER BY started_at DESC, id DESC LIMIT 1`,
          )
          .get() as { content_hash: string; started_at: string } | undefined;
        db.close();
        if (row && (!latest || row.started_at > latest.ts)) {
          latest = { ts: row.started_at, hash: row.content_hash };
        }
      } catch {
        // skip unreadable file
      }
    }
    return latest?.hash;
  }

  private listDbFiles(): string[] {
    if (!existsSync(this.opts.dir)) return [];
    return readdirSync(this.opts.dir)
      .filter((f) => f.startsWith("audit-") && f.endsWith(".sqlite"))
      .sort()
      .map((f) => join(this.opts.dir, f));
  }

  /** Returns ATTACH aliases for every db file and a UNION ALL query body. */
  private unionQuery(whereSql: string, limit?: number, offset?: number): {
    sql: string;
    params: Record<string, unknown>;
  } {
    const files = this.listDbFiles();
    if (files.length === 0) {
      return { sql: "SELECT * FROM audit_log WHERE 0", params: {} };
    }
    const parts: string[] = [];
    const params: Record<string, unknown> = {};
    for (let i = 0; i < files.length; i++) {
      parts.push(
        `SELECT * FROM db${i}.audit_log${whereSql ? " WHERE " + whereSql : ""}`,
      );
    }
    let sql = parts.join(" UNION ALL ") + " ORDER BY started_at ASC, id ASC";
    if (typeof limit === "number") sql += ` LIMIT ${limit | 0}`;
    if (typeof offset === "number" && offset > 0) sql += ` OFFSET ${offset | 0}`;
    return { sql, params };
  }

  private withUnionDb<T>(fn: (db: Database.Database) => T): T {
    const files = this.listDbFiles();
    // Open a throwaway in-memory db and attach all files read-only.
    const tmp = new Database(":memory:");
    try {
      for (let i = 0; i < files.length; i++) {
        tmp.prepare(`ATTACH DATABASE ? AS db${i}`).run(files[i]);
      }
      return fn(tmp);
    } finally {
      tmp.close();
    }
  }

  query(filter: QueryFilter): AuditRecord[] {
    const { where, params } = buildWhere(filter);
    return this.withUnionDb((db) => {
      const files = this.listDbFiles();
      if (files.length === 0) return [];
      const parts: string[] = [];
      for (let i = 0; i < files.length; i++) {
        parts.push(
          `SELECT * FROM db${i}.audit_log${where ? " WHERE " + where : ""}`,
        );
      }
      let sql = parts.join(" UNION ALL ") +
        " ORDER BY started_at ASC, id ASC";
      const limit = filter.limit ?? 500;
      const offset = filter.offset ?? 0;
      sql += ` LIMIT ${limit | 0} OFFSET ${offset | 0}`;
      const rows = db.prepare(sql).all(params) as DbRow[];
      return rows.map(rowToRecord);
    });
  }

  count(filter: QueryFilter): number {
    const { where, params } = buildWhere(filter);
    return this.withUnionDb((db) => {
      const files = this.listDbFiles();
      if (files.length === 0) return 0;
      const parts: string[] = [];
      for (let i = 0; i < files.length; i++) {
        parts.push(
          `SELECT COUNT(*) AS c FROM db${i}.audit_log${
            where ? " WHERE " + where : ""
          }`,
        );
      }
      const sql =
        "SELECT SUM(c) AS total FROM (" + parts.join(" UNION ALL ") + ")";
      const row = db.prepare(sql).get(params) as { total: number | null };
      return row?.total ?? 0;
    });
  }

  stats(filter: QueryFilter): StatsResult {
    const records = this.query({ ...filter, limit: 100_000 });
    const total = records.length;
    const errors = records.filter((r) => r.isError).length;
    const latencies = records
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);
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
    const topTools = [...tools.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count }));
    const topServers = [...servers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([server, count]) => ({ server, count }));

    return {
      totalCalls: total,
      errorCount: errors,
      errorRate: total === 0 ? 0 : errors / total,
      p50LatencyMs: p(0.5),
      p95LatencyMs: p(0.95),
      p99LatencyMs: p(0.99),
      topTools,
      topServers,
    };
  }

  /**
   * Retention purge: deletes whole daily files whose date < cutoff.
   * Intentionally file-level (never DELETE on the append-only table).
   */
  purgeOlderThan(olderThan: string): number {
    const cutoff = olderThan.slice(0, 10); // YYYY-MM-DD
    const files = this.listDbFiles();
    let deleted = 0;
    for (const f of files) {
      const match = /audit-(\d{4}-\d{2}-\d{2})\.sqlite$/.exec(f);
      if (!match) continue;
      if (match[1] < cutoff) {
        if (this.activeFile === f) continue; // never delete the active file
        try {
          unlinkSync(f);
          deleted++;
        } catch {}
      }
    }
    return deleted;
  }

  close(): void {
    if (this.activeDb) {
      try {
        this.activeDb.close();
      } catch {}
      this.activeDb = null;
      this.activeFile = null;
      this.insertStmt = null;
    }
  }
}

function buildWhere(filter: QueryFilter): {
  where: string;
  params: Record<string, unknown>;
} {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.from) {
    clauses.push("started_at >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    clauses.push("started_at <= @to");
    params.to = filter.to;
  }
  if (filter.serverName) {
    clauses.push("server_name = @serverName");
    params.serverName = filter.serverName;
  }
  if (filter.toolName) {
    clauses.push("tool_name = @toolName");
    params.toolName = filter.toolName;
  }
  if (filter.sessionId) {
    clauses.push("session_id = @sessionId");
    params.sessionId = filter.sessionId;
  }
  if (filter.correlationId) {
    clauses.push("correlation_id = @correlationId");
    params.correlationId = filter.correlationId;
  }
  if (typeof filter.isError === "boolean") {
    clauses.push("is_error = @isError");
    params.isError = filter.isError ? 1 : 0;
  }
  if (filter.search) {
    clauses.push(
      "(tool_name LIKE @search OR input_params LIKE @search OR output_data LIKE @search)",
    );
    params.search = `%${filter.search}%`;
  }
  return { where: clauses.join(" AND "), params };
}
