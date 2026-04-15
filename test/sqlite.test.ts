import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorage } from "../src/logging/storage/sqlite.js";
import { LogEngine } from "../src/logging/log-engine.js";
import { verifyChain } from "../src/logging/hash-chain.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "mcpaudit-test-"));
}

test("SqliteStorage append + query round-trip", async () => {
  const dir = tmpDir();
  try {
    const storage = new SqliteStorage({ dir, appendOnly: true });
    storage.init();
    const engine = new LogEngine(storage, undefined);
    await engine.init();

    const now = new Date();
    for (let i = 0; i < 5; i++) {
      await engine.record({
        sessionId: "s1",
        serverName: "fs",
        toolName: "read_file",
        method: "tools/call",
        inputParams: { path: `/f${i}` },
        outputData: { content: `x${i}` },
        isError: false,
        startedAt: now,
        completedAt: new Date(now.getTime() + 3),
      });
    }

    const rows = storage.query({ limit: 100 });
    assert.equal(rows.length, 5);
    const verify = verifyChain(rows);
    assert.equal(verify.ok, true);
    assert.equal(verify.verified, 5);
    await engine.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SqliteStorage redacts sensitive field keys", async () => {
  const dir = tmpDir();
  try {
    const storage = new SqliteStorage({ dir, appendOnly: true });
    storage.init();
    const engine = new LogEngine(storage, {
      redact_fields: ["password", "api[_-]?key"],
    });
    await engine.init();
    const now = new Date();
    await engine.record({
      sessionId: "s1",
      serverName: "api",
      toolName: "login",
      method: "tools/call",
      inputParams: { username: "joe", password: "hunter2", api_key: "sk-abc" },
      outputData: { ok: true },
      isError: false,
      startedAt: now,
      completedAt: now,
    });
    const rows = storage.query({ limit: 10 });
    const input = rows[0].inputParams as Record<string, unknown>;
    assert.equal(input.password, "[REDACTED]");
    assert.equal(input.api_key, "[REDACTED]");
    assert.equal(input.username, "joe");
    await engine.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SqliteStorage append-only trigger rejects UPDATE", async () => {
  const dir = tmpDir();
  try {
    const storage = new SqliteStorage({ dir, appendOnly: true });
    storage.init();
    const engine = new LogEngine(storage, undefined);
    await engine.init();
    const now = new Date();
    await engine.record({
      sessionId: "s1",
      serverName: "fs",
      toolName: "ls",
      method: "tools/call",
      inputParams: {},
      outputData: {},
      isError: false,
      startedAt: now,
      completedAt: now,
    });
    // Reach through the private db to attempt a forbidden update
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (storage as any).activeDb;
    assert.throws(
      () => db.prepare("UPDATE audit_log SET tool_name = 'evil'").run(),
      /append-only/,
    );
    await engine.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
