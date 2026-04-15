import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signExport, verifyExport } from "../src/compliance/signed-export.js";

test("signExport then verifyExport round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcpaudit-key-"));
  try {
    const keyPath = join(dir, "export.key");
    const body = JSON.stringify({ records: [{ id: "a" }, { id: "b" }] });
    const sig = signExport(body, keyPath);
    assert.equal(sig.algorithm, "ed25519");
    assert.equal(verifyExport(body, sig), true);
    assert.equal(verifyExport(body + "tampered", sig), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
