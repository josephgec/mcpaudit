#!/usr/bin/env node
import { Command } from "commander";
import { runStart } from "./commands/start.js";
import { runLogs } from "./commands/logs.js";
import { runStats } from "./commands/stats.js";
import { runExport } from "./commands/export.js";
import { runVerify } from "./commands/verify.js";
import { runReport } from "./commands/report.js";
import { runHashPassword } from "./commands/hash-password.js";

const program = new Command();
program
  .name("mcpaudit")
  .description("Transparent MCP proxy with full audit logging")
  .version("0.1.0");

program
  .command("start")
  .description("Start the MCP proxy with logging")
  .option("-c, --config <path>", "config file path", "mcpaudit.config.yaml")
  .action(async (o) => {
    try {
      await runStart({ config: o.config });
    } catch (e) {
      die(e);
    }
  });

program
  .command("logs")
  .description("Query or tail audit logs")
  .option("-c, --config <path>", "config file path", "mcpaudit.config.yaml")
  .option("--from <iso>", "start timestamp (ISO 8601)")
  .option("--to <iso>", "end timestamp (ISO 8601)")
  .option("--server <name>", "filter by server name")
  .option("--tool <name>", "filter by tool name")
  .option("--session-id <id>", "filter by session ID")
  .option("--correlation-id <id>", "filter by correlation ID")
  .option("--limit <n>", "max rows", "100")
  .option("--tail", "follow new entries")
  .option("--json", "JSON output")
  .action(async (o) => {
    try {
      await runLogs(o);
    } catch (e) {
      die(e);
    }
  });

program
  .command("stats")
  .description("Summary statistics")
  .option("-c, --config <path>", "config file path", "mcpaudit.config.yaml")
  .option("--last <span>", "time range (e.g. 24h, 7d)")
  .option("--server <name>", "filter by server name")
  .option("--tool <name>", "filter by tool name")
  .option("--json", "JSON output")
  .action(async (o) => {
    try {
      await runStats(o);
    } catch (e) {
      die(e);
    }
  });

program
  .command("export")
  .description("Export audit logs")
  .option("-c, --config <path>", "config file path", "mcpaudit.config.yaml")
  .option("--from <iso>", "start timestamp")
  .option("--to <iso>", "end timestamp")
  .option("--format <fmt>", "json | csv | ndjson", "json")
  .requiredOption("-o, --output <path>", "output file path")
  .option("--sign", "produce an Ed25519 signature alongside the export")
  .option("--key-path <path>", "path to signing keypair (default: ./keys/export.key)")
  .action(async (o) => {
    try {
      await runExport(o);
    } catch (e) {
      die(e);
    }
  });

program
  .command("verify")
  .description("Verify the hash chain integrity of stored records")
  .option("-c, --config <path>", "config file path", "mcpaudit.config.yaml")
  .option("--from <iso>", "start timestamp")
  .option("--to <iso>", "end timestamp")
  .action(async (o) => {
    try {
      await runVerify(o);
    } catch (e) {
      die(e);
    }
  });

program
  .command("report")
  .description("Generate a compliance report over a time range")
  .option("-c, --config <path>", "config file path", "mcpaudit.config.yaml")
  .option("--from <iso>", "start timestamp")
  .option("--to <iso>", "end timestamp")
  .option("-o, --output <path>", "output file (default: stdout)")
  .action(async (o) => {
    try {
      await runReport(o);
    } catch (e) {
      die(e);
    }
  });

program
  .command("hash-password")
  .description("Compute a bcrypt hash of a password for dashboard auth")
  .argument("<password>")
  .action(async (pw) => {
    try {
      await runHashPassword(pw);
    } catch (e) {
      die(e);
    }
  });

program.parseAsync(process.argv);

function die(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}
