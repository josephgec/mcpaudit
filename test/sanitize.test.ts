import { test } from "node:test";
import assert from "node:assert/strict";
import { Sanitizer } from "../src/logging/sanitize.js";

test("Sanitizer redacts configured field keys recursively", () => {
  const s = new Sanitizer({
    redact_fields: ["password", "secret"],
  });
  const out = s.sanitize({
    user: "alice",
    password: "hunter2",
    nested: { secret: "shh" },
  }) as Record<string, unknown>;
  assert.equal(out.user, "alice");
  assert.equal(out.password, "[REDACTED]");
  assert.equal((out.nested as Record<string, unknown>).secret, "[REDACTED]");
});

test("Sanitizer detects and redacts PII in strings", () => {
  const s = new Sanitizer({
    pii: { enabled: true, mode: "redact", detectors: ["email", "ssn"] },
  });
  const out = s.sanitize("Contact alice@example.com SSN 123-45-6789");
  assert.match(String(out), /\[PII:email\]/);
  assert.match(String(out), /\[PII:ssn\]/);
});

test("Sanitizer truncates oversized strings", () => {
  const s = new Sanitizer({ max_field_size_kb: 1 });
  const big = "x".repeat(2048);
  const out = s.sanitize(big) as string;
  assert.ok(out.endsWith("…[TRUNCATED]"));
  assert.ok(out.length < big.length);
});

test("Sanitizer hash mode produces stable tokens", () => {
  const s = new Sanitizer({
    pii: { enabled: true, mode: "hash", detectors: ["email"] },
  });
  const a = s.sanitize("alice@example.com") as string;
  const b = s.sanitize("alice@example.com") as string;
  assert.equal(a, b);
  assert.match(a, /\[PII:email:[0-9a-f]{12}\]/);
});
