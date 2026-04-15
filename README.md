# mcpaudit

A transparent [Model Context Protocol](https://modelcontextprotocol.io) proxy
that intercepts, logs, and audits every MCP tool invocation. Drop it between
an AI host (Claude, GPT, agents) and any MCP server to get a complete,
tamper-evident record of what your agents actually did.

```
┌──────────┐      ┌─────────────────┐      ┌────────────┐
│  AI Host │─────▶│  mcpaudit proxy  │─────▶│  MCP Server│
│ (Claude, │◀─────│                  │◀─────│  (any)     │
│  GPT, …) │      │  ┌────────────┐ │      └────────────┘
└──────────┘      │  │ Log Engine │ │
                  │  └─────┬──────┘ │
                  └────────┼────────┘
                           ▼
                  ┌────────────────┐
                  │ SQLite / PG    │
                  │ (append-only   │
                  │  hash chain)   │
                  └────────────────┘
```

## Features

- **Transparent proxy** — forwards `tools/*`, `resources/*`, `prompts/*`, and
  `completion/*` MCP methods over stdio or HTTP+SSE
- **Append-only hash chain** — every record is SHA-256 chained to the previous
  one; tampering is detected by `mcpaudit verify`
- **Multi-upstream multiplexer** — combine N MCP servers into one, with per-
  upstream routing via `name__tool` prefixes
- **PII detection & redaction** — regex-based scanners for email, SSN, phone,
  credit cards, plus configurable key-name redaction
- **Local dashboard** — zero-dependency HTML UI on `localhost:3101` with
  live feed, stats, and session search
- **Alerting engine** — declarative rules (`error_rate > 0.1 over 5m`) with
  webhook delivery and cooldown
- **Compliance reports** — summary JSON with totals, PII events, hash chain
  verification, and retention bounds
- **Signed exports** — Ed25519-signed JSON/NDJSON/CSV exports for auditors
- **Storage backends** — SQLite (default, zero config) and PostgreSQL
  (production, partitioning, RLS-ready)

## Install

```bash
npm install -g @josephgec/mcpaudit
```

The CLI binary is still named `mcpaudit`.

## Quickstart

1. Create a config:

```yaml
# mcpaudit.config.yaml
proxy:
  transport: stdio

upstream:
  name: filesystem
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]

logging:
  storage: sqlite
  path: ./audit-logs
  retention_days: 90

dashboard:
  enabled: true
  port: 3101
```

2. Point your AI host at `mcpaudit start` instead of the upstream server:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcpaudit",
      "args": ["start", "--config", "/path/to/mcpaudit.config.yaml"]
    }
  }
}
```

3. Open the dashboard at http://localhost:3101 and query logs via CLI:

```bash
mcpaudit logs --tail
mcpaudit stats --last 24h
mcpaudit export --from 2026-01-01 --format json --output audit-q1.json --sign
mcpaudit verify
mcpaudit report --from 2026-01-01 --output q1-compliance.json
```

## CLI reference

| Command | Description |
| --- | --- |
| `mcpaudit start [-c config]` | Start the proxy + dashboard + alert engine |
| `mcpaudit logs [--tail] [--from] [--tool] [--session-id]` | Query or tail audit records |
| `mcpaudit stats [--last 24h]` | Summary stats: totals, error rate, latency percentiles |
| `mcpaudit export -o file.json [--sign]` | Export records, optionally Ed25519-signed |
| `mcpaudit verify [--from]` | Re-derive and check the hash chain |
| `mcpaudit report -o report.json` | Auditor-ready compliance report |
| `mcpaudit hash-password <password>` | Bcrypt hash for dashboard auth config |

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/proxy/stdio-proxy.ts` | Single-upstream stdio transparent proxy |
| `src/proxy/sse-proxy.ts` | HTTP+SSE transport variant |
| `src/proxy/multiplexer.ts` | Multi-upstream stdio proxy with name prefixing |
| `src/logging/log-engine.ts` | Serial append pipeline: sanitize → hash → store |
| `src/logging/hash-chain.ts` | Deterministic canonicalization + SHA-256 chain |
| `src/logging/sanitize.ts` | Key redaction + PII detection |
| `src/logging/storage/sqlite.ts` | Daily-rotated SQLite files with append-only triggers |
| `src/logging/storage/postgres.ts` | Production Postgres backend |
| `src/dashboard/server.ts` | Local HTTP dashboard + live SSE feed |
| `src/alerts/engine.ts` | Rule parser + scheduled evaluator |
| `src/compliance/signed-export.ts` | Ed25519 export signing |
| `src/compliance/report.ts` | Auditor report generation |
| `src/cloud/forwarder.ts` | Client-side forwarder to hosted ingest endpoint |

## Hash chain integrity

Every record includes `contentHash = SHA-256(canonical(record) + previousHash)`.
Records are written serially through a single queue so the chain is globally
ordered. `mcpaudit verify` re-derives each hash from scratch and bails on the
first mismatch, pointing to the broken record ID.

At the storage layer:
- **SQLite:** `BEFORE UPDATE` / `BEFORE DELETE` triggers raise `append-only`.
  Retention purges happen at the file level (delete whole old daily files).
- **Postgres:** `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC` on init; the
  application role must not own the table in production.

## Cloud (hosted) option

`mcpaudit` ships with a thin client-side forwarder
(`src/cloud/forwarder.ts`) that streams records to a hosted ingest endpoint.
The hosted service — managed dashboard, multi-tenant storage, billing, SSO,
SOC 2 / HIPAA surface — lives in a separate private repo, `mcpaudit-cloud`.

To enable forwarding, add a `cloud:` block to your config:

```yaml
cloud:
  enabled: true
  ingest_url: https://ingest.mcpaudit.dev/v1/logs
  api_key: ...
```

Local storage remains the source of truth; forwarding failures drop batches
rather than blocking the local write path.

## License

MIT — see [LICENSE](LICENSE).
