import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCondition } from "../src/alerts/engine.js";

test("parseCondition: error_rate over minutes", () => {
  const p = parseCondition("error_rate > 0.1 over 5m");
  assert.equal(p.metric, "error_rate");
  assert.equal(p.op, ">");
  assert.equal(p.threshold, 0.1);
  assert.equal(p.windowSec, 300);
});

test("parseCondition: p95_latency with ms unit", () => {
  const p = parseCondition("p95_latency > 5000ms");
  assert.equal(p.metric, "p95_latency");
  assert.equal(p.threshold, 5000);
});

test("parseCondition: per-tool filter", () => {
  const p = parseCondition("call_count > 1000 over 10m for tool query_db");
  assert.equal(p.metric, "call_count");
  assert.equal(p.windowSec, 600);
  assert.equal(p.toolGlob, "query_db");
});

test("parseCondition: rejects unknown metric", () => {
  assert.throws(() => parseCondition("foo > 1"));
});
