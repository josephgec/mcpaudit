import type { AlertRule } from "../types.js";
import type { Storage } from "../logging/storage/interface.js";
import { deliverWebhook } from "./webhook.js";

/**
 * Tiny declarative alerting engine. Parses condition strings of the forms:
 *   "error_rate > 0.1 over 5m"
 *   "p95_latency > 5000"
 *   "p95_latency > 5000 for tool X"
 *   "call_count > 1000 over 10m"
 * and evaluates them at a fixed interval against the storage layer.
 */
export interface ParsedRule {
  raw: string;
  metric: "error_rate" | "p95_latency" | "p50_latency" | "call_count";
  op: ">" | "<" | ">=" | "<=";
  threshold: number;
  windowSec: number;
  toolGlob?: string;
}

export function parseCondition(s: string): ParsedRule {
  const toolMatch = /\s+for tool\s+(\S+)\s*$/.exec(s);
  const toolGlob = toolMatch?.[1];
  const cleaned = toolMatch ? s.slice(0, toolMatch.index) : s;

  const overMatch = /\s+over\s+(\d+)([smhd])\s*$/.exec(cleaned);
  const windowSec = overMatch
    ? toSeconds(parseInt(overMatch[1], 10), overMatch[2])
    : 300;
  const body = overMatch ? cleaned.slice(0, overMatch.index) : cleaned;

  const m = /^\s*(error_rate|p95_latency|p50_latency|call_count)\s*(>=|<=|>|<)\s*([\d.]+)\s*(?:ms)?\s*$/.exec(
    body,
  );
  if (!m) throw new Error(`cannot parse alert condition: ${s}`);
  return {
    raw: s,
    metric: m[1] as ParsedRule["metric"],
    op: m[2] as ParsedRule["op"],
    threshold: parseFloat(m[3]),
    windowSec,
    toolGlob,
  };
}

function toSeconds(n: number, unit: string): number {
  switch (unit) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
  }
  return n;
}

function compare(value: number, op: ParsedRule["op"], threshold: number): boolean {
  switch (op) {
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
  }
}

export class AlertEngine {
  private parsed: Array<{ rule: AlertRule; parsed: ParsedRule }> = [];
  private timer: NodeJS.Timeout | null = null;
  /** Track last fire per rule to avoid flapping. */
  private lastFired = new Map<string, number>();
  private cooldownMs = 60_000;

  constructor(
    rules: AlertRule[],
    private storage: Storage,
    private intervalMs = 60_000,
  ) {
    for (const rule of rules) {
      try {
        this.parsed.push({ rule, parsed: parseCondition(rule.condition) });
      } catch (e) {
        process.stderr.write(
          `[mcpaudit] failed to parse alert "${rule.name}": ${
            e instanceof Error ? e.message : String(e)
          }\n`,
        );
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    // Don't hold the event loop open if nothing else is running.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    for (const { rule, parsed } of this.parsed) {
      try {
        const fired = await this.evaluate(parsed);
        if (!fired) continue;
        const last = this.lastFired.get(rule.name) ?? 0;
        if (Date.now() - last < this.cooldownMs) continue;
        this.lastFired.set(rule.name, Date.now());
        await this.fire(rule, parsed, fired);
      } catch (e) {
        process.stderr.write(
          `[mcpaudit] alert "${rule.name}" error: ${
            e instanceof Error ? e.message : String(e)
          }\n`,
        );
      }
    }
  }

  private async evaluate(
    parsed: ParsedRule,
  ): Promise<{ value: number } | null> {
    const from = new Date(
      Date.now() - parsed.windowSec * 1000,
    ).toISOString();
    const filter = {
      from,
      toolName: parsed.toolGlob && parsed.toolGlob !== "*" ? parsed.toolGlob : undefined,
    };
    const stats = await Promise.resolve(this.storage.stats(filter));
    let value: number;
    switch (parsed.metric) {
      case "error_rate":
        value = stats.errorRate;
        break;
      case "p95_latency":
        value = stats.p95LatencyMs;
        break;
      case "p50_latency":
        value = stats.p50LatencyMs;
        break;
      case "call_count":
        value = stats.totalCalls;
        break;
    }
    return compare(value, parsed.op, parsed.threshold) ? { value } : null;
  }

  private async fire(
    rule: AlertRule,
    parsed: ParsedRule,
    result: { value: number },
  ): Promise<void> {
    const msg =
      `[mcpaudit-alert] ${rule.name}: ${parsed.metric}=${result.value} ` +
      `${parsed.op} ${parsed.threshold} (window ${parsed.windowSec}s)`;

    if (rule.action === "webhook" && rule.url) {
      await deliverWebhook(rule.url, {
        name: rule.name,
        condition: rule.condition,
        metric: parsed.metric,
        value: result.value,
        threshold: parsed.threshold,
        windowSec: parsed.windowSec,
        firedAt: new Date().toISOString(),
      });
    }
    process.stderr.write(msg + "\n");
  }
}
