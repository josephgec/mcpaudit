import { loadConfig } from "../config.js";
import { buildStorage } from "../bootstrap.js";
import type { AuditRecord } from "../../logging/schema.js";

export interface LogsOptions {
  config: string;
  from?: string;
  to?: string;
  server?: string;
  tool?: string;
  correlationId?: string;
  sessionId?: string;
  limit?: string;
  tail?: boolean;
  json?: boolean;
}

export async function runLogs(opts: LogsOptions): Promise<void> {
  const cfg = loadConfig(opts.config);
  const storage = await buildStorage(cfg);
  const filter = {
    from: opts.from,
    to: opts.to,
    serverName: opts.server,
    toolName: opts.tool,
    correlationId: opts.correlationId,
    sessionId: opts.sessionId,
    limit: opts.limit ? parseInt(opts.limit, 10) : 100,
  };

  if (opts.tail) {
    const seen = new Set<string>();
    const initial = await Promise.resolve(storage.query(filter));
    for (const r of initial) {
      seen.add(r.id);
      print(r, !!opts.json);
    }
    const poll = async () => {
      const rows = await Promise.resolve(storage.query({ ...filter, limit: 200 }));
      for (const r of rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          print(r, !!opts.json);
        }
      }
    };
    const interval = setInterval(() => void poll(), 1000);
    process.on("SIGINT", () => {
      clearInterval(interval);
      void Promise.resolve(storage.close()).then(() => process.exit(0));
    });
    return;
  }

  const rows = await Promise.resolve(storage.query(filter));
  for (const r of rows) print(r, !!opts.json);
  await Promise.resolve(storage.close());
}

function print(r: AuditRecord, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(r) + "\n");
    return;
  }
  const status = r.isError ? "ERR" : "OK ";
  const line =
    `${r.startedAt}  ${status}  ${r.latencyMs.toString().padStart(5)}ms  ` +
    `${r.serverName}/${r.toolName}  ${r.method}  ` +
    `session=${r.sessionId.slice(-6)}`;
  process.stdout.write(line + "\n");
  if (r.isError && r.errorMessage) {
    process.stdout.write(`    ! ${r.errorMessage}\n`);
  }
}
