# Changelog

All notable changes to `@josephgec/mcpaudit` are documented here. The format
loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] — 2026-04-15

### Added — secret-content sanitization

Closes the gap that the v0.1.1 e2e test against the official filesystem
MCP server surfaced: when a tool returned a file's text content containing
literal `"password":"hunter2"`, the value was logged verbatim because the
sanitizer only redacted *object keys*, not content embedded inside string
fields.

Two complementary mechanisms were added to `Sanitizer`:

- **Embedded JSON parsing.** When a string field looks like JSON (starts
  with `{` or `[` after trimming), it is parsed, recursively walked, and
  re-serialized — so secret keys inside file contents now match the same
  `redact_fields` rules that apply at the top level.
- **Secret-in-text detectors.** Eight regex-based scanners catch common
  token formats and key-value pairs:
  - `bearer` — `Authorization: Bearer …`
  - `jwt` — `eyJ…`
  - `github_pat` — `ghp_…`, `gho_…`, etc.
  - `aws_access_key` — `AKIA…`
  - `openai_key` — `sk-…`
  - `anthropic_key` — `sk-ant-…`
  - `slack_token` — `xoxb-…`, `xoxp-…`
  - `kv_secret` — `password=…`, `api_key: …`, `"secret":"…"`

A negative lookbehind on `kv_secret` prevents it from re-tagging the
placeholders that token-format detectors emit (e.g., refusing to match the
`secret:` substring inside `[SECRET:aws_access_key]`).

Both surfaces are configurable via the new `sanitization.secrets` and
`sanitization.parse_embedded_json` keys in `mcpaudit.config.yaml`.
Defaults are on, since the false-positive cost of a slightly noisier audit
log is much lower than the cost of leaking a token.

### Fixed

- `bin` field in `package.json` is now correctly registered on install.
  v0.1.0 was published with `"./dist/cli/index.js"`, which npm's publish
  validator stripped without warning, leaving `npm install -g` with no
  executable. v0.1.1 normalized it to `"dist/cli/index.js"`.
- Proxy handler registration now matches the upstream's declared
  `ServerCapabilities`. v0.1.0 unconditionally registered `resources` and
  `prompts` handlers, which the MCP SDK rejects at startup when the
  upstream (e.g., `@modelcontextprotocol/server-filesystem`) only declares
  `tools`.

### Tests

24 passing (was 17). New: 7 sanitizer tests covering embedded JSON
parsing, all eight secret detectors, and the kv vs. token interaction.

### Migration notes

Backwards compatible — all new sanitization config fields default to
sensible behavior. To opt out:

```yaml
sanitization:
  secrets:
    enabled: false
  parse_embedded_json: false
```

## [0.1.1] — 2026-04-15

- Normalize `bin` path so `npm install -g @josephgec/mcpaudit` actually
  installs the `mcpaudit` command.

## [0.1.0] — 2026-04-15

Initial release. MCP transparent proxy (stdio + SSE), append-only SQLite
storage with hash chain, daily rotation, multi-upstream multiplexer,
embedded local dashboard, declarative webhook alerting, PostgreSQL
backend, Ed25519 signed exports, compliance reports, retention
enforcement, bcrypt RBAC for the dashboard, client-side cloud forwarder.
