import type { AuditRecord } from "../schema.js";

export interface QueryFilter {
  from?: string;
  to?: string;
  serverName?: string;
  toolName?: string;
  sessionId?: string;
  correlationId?: string;
  isError?: boolean;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface StatsResult {
  totalCalls: number;
  errorCount: number;
  errorRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  topTools: Array<{ tool: string; count: number }>;
  topServers: Array<{ server: string; count: number }>;
}

export interface Storage {
  init(): Promise<void> | void;
  append(record: AuditRecord): Promise<void> | void;
  /** Returns the most recently appended record's contentHash, or undefined. */
  getLastHash(): Promise<string | undefined> | string | undefined;
  query(filter: QueryFilter): Promise<AuditRecord[]> | AuditRecord[];
  count(filter: QueryFilter): Promise<number> | number;
  stats(filter: QueryFilter): Promise<StatsResult> | StatsResult;
  /** Purges records older than `olderThan` (ISO timestamp). Returns deleted count. */
  purgeOlderThan(olderThan: string): Promise<number> | number;
  close(): Promise<void> | void;
}
