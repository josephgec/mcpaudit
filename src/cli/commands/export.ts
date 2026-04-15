import { writeFileSync } from "node:fs";
import { loadConfig } from "../config.js";
import { buildStorage } from "../bootstrap.js";
import { signExport } from "../../compliance/signed-export.js";
import type { AuditRecord } from "../../logging/schema.js";

export interface ExportOptions {
  config: string;
  from?: string;
  to?: string;
  format?: "json" | "csv" | "ndjson";
  output: string;
  sign?: boolean;
  keyPath?: string;
}

export async function runExport(opts: ExportOptions): Promise<void> {
  const cfg = loadConfig(opts.config);
  const storage = await buildStorage(cfg);
  const records = await Promise.resolve(
    storage.query({ from: opts.from, to: opts.to, limit: 1_000_000 }),
  );
  await Promise.resolve(storage.close());

  const fmt = opts.format ?? "json";
  let body: string;
  if (fmt === "json") {
    body = JSON.stringify(records, null, 2);
  } else if (fmt === "ndjson") {
    body = records.map((r) => JSON.stringify(r)).join("\n");
  } else {
    body = toCsv(records);
  }
  writeFileSync(opts.output, body);

  if (opts.sign) {
    const sig = signExport(body, opts.keyPath);
    writeFileSync(opts.output + ".sig", JSON.stringify(sig, null, 2));
    process.stderr.write(
      `[mcpaudit] wrote ${records.length} records + signature\n`,
    );
  } else {
    process.stderr.write(
      `[mcpaudit] wrote ${records.length} records to ${opts.output}\n`,
    );
  }
}

function toCsv(records: AuditRecord[]): string {
  const cols = [
    "id",
    "correlationId",
    "sessionId",
    "serverName",
    "toolName",
    "method",
    "isError",
    "errorMessage",
    "startedAt",
    "completedAt",
    "latencyMs",
    "userIdentity",
    "contentHash",
  ];
  const header = cols.join(",");
  const rows = records.map((r) =>
    cols
      .map((c) => csvCell((r as unknown as Record<string, unknown>)[c]))
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
