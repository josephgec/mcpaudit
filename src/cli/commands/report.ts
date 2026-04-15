import { loadConfig } from "../config.js";
import { buildStorage } from "../bootstrap.js";
import { generateComplianceReport } from "../../compliance/report.js";

export interface ReportOptions {
  config: string;
  from?: string;
  to?: string;
  output?: string;
}

export async function runReport(opts: ReportOptions): Promise<void> {
  const cfg = loadConfig(opts.config);
  const storage = await buildStorage(cfg);
  const records = await Promise.resolve(
    storage.query({ from: opts.from, to: opts.to, limit: 1_000_000 }),
  );
  await Promise.resolve(storage.close());

  const report = generateComplianceReport(records, {
    from: opts.from,
    to: opts.to,
    retentionDays: cfg.logging.retention_days,
  });

  const body = JSON.stringify(report, null, 2);
  if (opts.output) {
    const fs = await import("node:fs");
    fs.writeFileSync(opts.output, body);
    process.stderr.write(
      `[mcpaudit] compliance report written to ${opts.output}\n`,
    );
  } else {
    process.stdout.write(body + "\n");
  }
}
