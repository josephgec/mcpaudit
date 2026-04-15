import { createHash } from "node:crypto";
import type { SanitizationConfig } from "../types.js";

const DEFAULT_REDACT_FIELDS = [
  "password",
  "secret",
  "token",
  "api[_-]?key",
  "authorization",
  "ssn",
  "credit[_-]?card",
];

const PII_PATTERNS: Record<string, RegExp> = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[ -]?){13,19}\b/g,
  ip: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
};

export class Sanitizer {
  private fieldPatterns: RegExp[];
  private maxBytes: number;
  private piiEnabled: boolean;
  private piiMode: "redact" | "hash" | "allow";
  private piiDetectors: string[];

  constructor(cfg: SanitizationConfig | undefined) {
    const fields = cfg?.redact_fields ?? DEFAULT_REDACT_FIELDS;
    this.fieldPatterns = fields.map((p) => new RegExp(p, "i"));
    this.maxBytes = Math.max(1, (cfg?.max_field_size_kb ?? 50) * 1024);
    this.piiEnabled = cfg?.pii?.enabled ?? false;
    this.piiMode = cfg?.pii?.mode ?? "redact";
    this.piiDetectors = cfg?.pii?.detectors ?? [
      "email",
      "phone",
      "ssn",
      "credit_card",
    ];
  }

  /**
   * Walks a value recursively, returning a deep-cloned version where
   *   - keys matching redact patterns are replaced with "[REDACTED]"
   *   - strings containing PII are redacted or hashed per config
   *   - strings longer than maxBytes are truncated with a marker
   */
  sanitize(value: unknown): unknown {
    return this.walk(value, 0);
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 64) return "[TRUNCATED:depth]";
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === "string") return this.sanitizeString(value as string);
    if (t === "number" || t === "boolean") return value;
    if (Array.isArray(value)) {
      return value.map((v) => this.walk(v, depth + 1));
    }
    if (t === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (this.isRedactedKey(k)) {
          out[k] = "[REDACTED]";
        } else {
          out[k] = this.walk(v, depth + 1);
        }
      }
      return out;
    }
    return String(value);
  }

  private isRedactedKey(key: string): boolean {
    return this.fieldPatterns.some((p) => p.test(key));
  }

  private sanitizeString(s: string): string {
    let out = s;
    if (this.piiEnabled) {
      for (const name of this.piiDetectors) {
        const pat = PII_PATTERNS[name];
        if (!pat) continue;
        out = out.replace(pat, (m) => this.applyPiiMode(name, m));
      }
    }
    if (Buffer.byteLength(out, "utf8") > this.maxBytes) {
      out = out.slice(0, this.maxBytes) + "…[TRUNCATED]";
    }
    return out;
  }

  private applyPiiMode(kind: string, value: string): string {
    switch (this.piiMode) {
      case "allow":
        return value;
      case "hash":
        return `[PII:${kind}:${sha256(value).slice(0, 12)}]`;
      case "redact":
      default:
        return `[PII:${kind}]`;
    }
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
