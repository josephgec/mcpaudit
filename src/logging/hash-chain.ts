import { createHash } from "node:crypto";
import type { AuditRecord } from "./schema.js";

/**
 * Deterministic hash over the audit-relevant fields of a record.
 * Intentionally excludes contentHash and previousHash from the input.
 */
export function computeContentHash(
  r: Omit<AuditRecord, "contentHash" | "previousHash">,
  previousHash: string | undefined,
): string {
  const canonical = canonicalize({
    id: r.id,
    correlationId: r.correlationId,
    sessionId: r.sessionId,
    serverName: r.serverName,
    toolName: r.toolName,
    method: r.method,
    inputParams: r.inputParams,
    outputData: r.outputData,
    isError: r.isError,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    latencyMs: r.latencyMs,
    userIdentity: r.userIdentity,
    clientInfo: r.clientInfo,
    estimatedCostUsd: r.estimatedCostUsd,
    previousHash: previousHash ?? "",
  });
  return sha256(canonical);
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Deterministic JSON: keys sorted recursively so hashes are reproducible
 * regardless of insertion order.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .filter((k) => obj[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
        .join(",") +
      "}"
    );
  }
  return "null";
}

export interface VerifyResult {
  ok: boolean;
  verified: number;
  brokenAt?: string;
  reason?: string;
}

/**
 * Walks the records in insertion order and re-derives each contentHash.
 * Fails fast on the first mismatch.
 */
export function verifyChain(records: AuditRecord[]): VerifyResult {
  let prev: string | undefined = undefined;
  let count = 0;
  for (const r of records) {
    const expected = computeContentHash(r, prev);
    if (expected !== r.contentHash) {
      return {
        ok: false,
        verified: count,
        brokenAt: r.id,
        reason: "content hash mismatch",
      };
    }
    if ((r.previousHash ?? undefined) !== (prev ?? undefined)) {
      return {
        ok: false,
        verified: count,
        brokenAt: r.id,
        reason: "previous hash mismatch",
      };
    }
    prev = r.contentHash;
    count++;
  }
  return { ok: true, verified: count };
}
