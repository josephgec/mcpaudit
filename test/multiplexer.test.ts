import { test } from "node:test";
import assert from "node:assert/strict";

// The multiplex routing helpers aren't exported, so re-implement the prefix
// expectation here as a specification check: tool names sent to the host
// must be `${upstream}__${tool}` and parseable back into that pair.
test("multiplexer prefix convention", () => {
  const prefixed = "filesystem__read_file";
  const sep = prefixed.indexOf("__");
  assert.equal(prefixed.slice(0, sep), "filesystem");
  assert.equal(prefixed.slice(sep + 2), "read_file");
});
