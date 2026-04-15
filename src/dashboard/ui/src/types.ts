// Mirrors the AuditRecord type from the server. Kept local rather than
// importing from the package so the UI stays a self-contained bundle.
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

export type View = "live" | "sessions" | "search" | "record";
