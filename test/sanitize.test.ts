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

test("Sanitizer parses embedded JSON in string fields and redacts keys", () => {
  const s = new Sanitizer({});
  const fileContent = '{"key":"value","password":"hunter2","api_key":"sk-abc"}';
  const out = s.sanitize({
    content: [{ type: "text", text: fileContent }],
  }) as { content: Array<{ text: string }> };
  const text = out.content[0].text;
  assert.match(text, /"password":"\[REDACTED\]"/);
  assert.match(text, /"api_key":"\[REDACTED\]"/);
  assert.match(text, /"key":"value"/);
});

test("Sanitizer detects Bearer tokens in plain text", () => {
  const s = new Sanitizer({});
  const out = s.sanitize(
    "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.foo.bar'",
  ) as string;
  assert.match(out, /\[SECRET:/);
  assert.doesNotMatch(out, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.foo\.bar/);
});

test("Sanitizer detects GitHub PATs", () => {
  const s = new Sanitizer({});
  const out = s.sanitize(
    "token: ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ) as string;
  assert.match(out, /\[SECRET:github_pat\]/);
});

test("Sanitizer detects AWS access keys", () => {
  const s = new Sanitizer({});
  const out = s.sanitize("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE") as string;
  assert.match(out, /\[SECRET:aws_access_key\]/);
});

test("Sanitizer kv pattern preserves the key but masks the value", () => {
  const s = new Sanitizer({});
  const out = s.sanitize("DB connection failed: password=hunter2 host=db") as string;
  assert.match(out, /password=\[SECRET/);
  assert.match(out, /host=db/);
  assert.doesNotMatch(out, /hunter2/);
});

test("Sanitizer can be configured to disable secret detection", () => {
  const s = new Sanitizer({ secrets: { enabled: false } });
  const out = s.sanitize("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") as string;
  assert.equal(out, "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("Sanitizer leaves non-JSON-looking strings alone for embedded parse", () => {
  const s = new Sanitizer({});
  const out = s.sanitize("just a regular sentence with no secrets") as string;
  assert.equal(out, "just a regular sentence with no secrets");
});
