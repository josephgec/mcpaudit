import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeContentHash,
  verifyChain,
  canonicalize,
} from "../src/logging/hash-chain.js";
import type { AuditRecord } from "../src/logging/schema.js";

function makeRecord(
  id: string,
  prev: string | undefined,
  tool = "echo",
): AuditRecord {
  const base = {
    id,
    correlationId: id,
    sessionId: "s1",
    serverName: "test",
    toolName: tool,
    method: "tools/call",
    inputParams: { foo: 1 },
    outputData: { bar: 2 },
    isError: false,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.005Z",
    latencyMs: 5,
  };
  const contentHash = computeContentHash(base, prev);
  return { ...base, contentHash, previousHash: prev };
}

test("canonicalize sorts object keys deterministically", () => {
  const a = canonicalize({ a: 1, b: { y: 2, x: 3 } });
  const b = canonicalize({ b: { x: 3, y: 2 }, a: 1 });
  assert.equal(a, b);
});

test("verifyChain returns ok for a well-formed chain", () => {
  const r1 = makeRecord("a", undefined);
  const r2 = makeRecord("b", r1.contentHash);
  const r3 = makeRecord("c", r2.contentHash);
  const result = verifyChain([r1, r2, r3]);
  assert.equal(result.ok, true);
  assert.equal(result.verified, 3);
});

test("verifyChain detects a tampered record", () => {
  const r1 = makeRecord("a", undefined);
  const r2 = makeRecord("b", r1.contentHash);
  const r3 = makeRecord("c", r2.contentHash);
  // Tamper: change toolName but don't recompute hash
  const tampered: AuditRecord = { ...r2, toolName: "evil" };
  const result = verifyChain([r1, tampered, r3]);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, "b");
});

test("verifyChain detects a broken previous-hash link", () => {
  const r1 = makeRecord("a", undefined);
  const r2 = makeRecord("b", r1.contentHash);
  const r3Broken: AuditRecord = {
    ...makeRecord("c", "deadbeef"),
  };
  const result = verifyChain([r1, r2, r3Broken]);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, "c");
});
