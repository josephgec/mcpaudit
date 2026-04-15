import type { AuditRecord } from "../logging/schema.js";
import { verifyChain } from "../logging/hash-chain.js";

export interface ComplianceReport {
  generatedAt: string;
  period: { from?: string; to?: string };
  totals: {
    calls: number;
    errors: number;
    uniqueUsers: number;
    uniqueServers: number;
    uniqueSessions: number;
  };
  piiEvents: number;
  integrity: {
    verified: number;
    ok: boolean;
    brokenAt?: string;
    reason?: string;
  };
  retention: {
    retentionDays?: number;
    oldestRecord?: string;
    newestRecord?: string;
  };
  anomalies: Array<{ kind: string; count: number; notes: string }>;
}

/**
 * Produces a summary suitable for handing to an auditor: call totals,
 * unique principals, PII access events, hash chain verification, and
 * retention bounds. Pure function over records; I/O at the call site.
 */
export function generateComplianceReport(
  records: AuditRecord[],
  opts: { from?: string; to?: string; retentionDays?: number },
): ComplianceReport {
  const users = new Set<string>();
  const servers = new Set<string>();
  const sessions = new Set<string>();
  let errors = 0;
  let piiEvents = 0;

  for (const r of records) {
    if (r.userIdentity) users.add(r.userIdentity);
    servers.add(r.serverName);
    sessions.add(r.sessionId);
    if (r.isError) errors++;
    if (containsPiiMarker(r.inputParams) || containsPiiMarker(r.outputData)) {
      piiEvents++;
    }
  }

  const integrity = verifyChain(records);

  const sorted = [...records].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  const oldest = sorted[0]?.startedAt;
  const newest = sorted[sorted.length - 1]?.startedAt;

  // Anomaly detectors — intentionally simple to keep zero config.
  const anomalies: ComplianceReport["anomalies"] = [];
  const errorRate = records.length === 0 ? 0 : errors / records.length;
  if (errorRate > 0.05) {
    anomalies.push({
      kind: "elevated_error_rate",
      count: errors,
      notes: `error rate ${(errorRate * 100).toFixed(2)}% exceeds 5% baseline`,
    });
  }
  const slowCalls = records.filter((r) => r.latencyMs > 10_000);
  if (slowCalls.length > 0) {
    anomalies.push({
      kind: "slow_calls",
      count: slowCalls.length,
      notes: "calls exceeding 10s latency",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { from: opts.from, to: opts.to },
    totals: {
      calls: records.length,
      errors,
      uniqueUsers: users.size,
      uniqueServers: servers.size,
      uniqueSessions: sessions.size,
    },
    piiEvents,
    integrity: {
      verified: integrity.verified,
      ok: integrity.ok,
      brokenAt: integrity.brokenAt,
      reason: integrity.reason,
    },
    retention: {
      retentionDays: opts.retentionDays,
      oldestRecord: oldest,
      newestRecord: newest,
    },
    anomalies,
  };
}

function containsPiiMarker(value: unknown): boolean {
  const s = JSON.stringify(value ?? null);
  return /\[PII:/.test(s);
}
