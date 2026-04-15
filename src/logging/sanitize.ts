import { createHash } from "node:crypto";
import type { SanitizationConfig } from "../types.js";

const DEFAULT_REDACT_FIELDS = [
  "password",
  "passwd",
  "pwd",
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

type SecretMode = "redact" | "hash" | "allow";

/**
 * Detectors for secrets that may appear inside string fields rather than
 * as object keys. Two flavors:
 *   - "token": match a secret-shaped substring; replace the whole match.
 *   - "kv":    match a `key=value` pair; preserve the key prefix and only
 *              mask the value (capture groups 1 and 2).
 */
interface SecretDetector {
  pattern: RegExp;
  kind: "token" | "kv";
  /** Optional fixed prefix to keep around the redacted value (e.g. "Bearer "). */
  prefix?: string;
}

const SECRET_DETECTORS: Record<string, SecretDetector> = {
  bearer: {
    pattern: /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}/g,
    kind: "token",
    prefix: "Bearer ",
  },
  jwt: {
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    kind: "token",
  },
  github_pat: {
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    kind: "token",
  },
  aws_access_key: {
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    kind: "token",
  },
  openai_key: {
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    kind: "token",
  },
  anthropic_key: {
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    kind: "token",
  },
  slack_token: {
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    kind: "token",
  },
  // Key-value style: catches `password=xxx`, `api_key: yyy`, `"secret":"zzz"`.
  // - `(?<!\[)` prevents matching `secret` inside our own `[SECRET:...]`
  //   placeholder, which would otherwise cause double-replacement when a
  //   token-format detector ran first.
  // - `(?!\[SECRET)` prevents tagging a value that's already a placeholder.
  kv_secret: {
    pattern:
      /(?<!\[)((?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth(?:orization)?)\s*["']?\s*[:=]\s*["']?)(?!\[SECRET)([^"'\s,;}\n]{3,})/gi,
    kind: "kv",
  },
};

function tag(kind: string, value: string, mode: SecretMode): string {
  if (mode === "allow") return value;
  if (mode === "hash") return `[SECRET:${kind}:${sha256(value).slice(0, 12)}]`;
  return `[SECRET:${kind}]`;
}

const DEFAULT_SECRET_DETECTORS = Object.keys(SECRET_DETECTORS);

export class Sanitizer {
  private fieldPatterns: RegExp[];
  private maxBytes: number;
  private piiEnabled: boolean;
  private piiMode: "redact" | "hash" | "allow";
  private piiDetectors: string[];
  private secretsEnabled: boolean;
  private secretsMode: SecretMode;
  private secretsDetectors: string[];
  private parseEmbeddedJson: boolean;

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

    // Secrets default to ON since the patterns have low false-positive rates
    // and the cost of leaking a token in an audit log is much higher than the
    // cost of an over-redacted log entry.
    this.secretsEnabled = cfg?.secrets?.enabled ?? true;
    this.secretsMode = cfg?.secrets?.mode ?? "redact";
    this.secretsDetectors = cfg?.secrets?.detectors ?? DEFAULT_SECRET_DETECTORS;

    this.parseEmbeddedJson = cfg?.parse_embedded_json ?? true;
  }

  /**
   * Walks a value recursively, returning a deep-cloned version where
   *   - object keys matching redact patterns are replaced with "[REDACTED]"
   *   - strings that look like JSON are parsed, walked, and re-serialized
   *   - strings containing PII are redacted or hashed per config
   *   - strings containing secret tokens are redacted or hashed per config
   *   - strings longer than maxBytes are truncated with a marker
   */
  sanitize(value: unknown): unknown {
    return this.walk(value, 0);
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 64) return "[TRUNCATED:depth]";
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === "string") return this.sanitizeString(value as string, depth);
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

  private sanitizeString(s: string, depth: number): string {
    // 1. Embedded JSON: if a string field contains a JSON object/array,
    //    parse it, recursively sanitize, and re-serialize. Catches the case
    //    where a tool returns file contents that happen to be JSON with
    //    secret keys.
    if (this.parseEmbeddedJson) {
      const reserialized = this.maybeSanitizeJsonString(s, depth);
      if (reserialized !== null) {
        return this.truncate(reserialized);
      }
    }

    let out = s;

    // 2. PII detection on plain text.
    if (this.piiEnabled) {
      for (const name of this.piiDetectors) {
        const pat = PII_PATTERNS[name];
        if (!pat) continue;
        out = out.replace(pat, (m) => this.applyPiiMode(name, m));
      }
    }

    // 3. Secret detection on plain text.
    if (this.secretsEnabled) {
      for (const name of this.secretsDetectors) {
        const detector = SECRET_DETECTORS[name];
        if (!detector) continue;
        if (detector.kind === "kv") {
          out = out.replace(
            detector.pattern,
            (_match, prefix: string, value: string) =>
              `${prefix}${tag(name, value, this.secretsMode)}`,
          );
        } else {
          out = out.replace(detector.pattern, (m) => {
            if (detector.prefix && m.startsWith(detector.prefix)) {
              return (
                detector.prefix +
                tag(name, m.slice(detector.prefix.length), this.secretsMode)
              );
            }
            return tag(name, m, this.secretsMode);
          });
        }
      }
    }

    return this.truncate(out);
  }

  /**
   * If `s` looks like JSON, parse it, sanitize the parsed value, and
   * return the JSON-serialized result. Returns null otherwise so the
   * caller falls through to plain-text scanners.
   */
  private maybeSanitizeJsonString(s: string, depth: number): string | null {
    const trimmed = s.trim();
    if (trimmed.length < 2) return null;
    const first = trimmed[0];
    if (first !== "{" && first !== "[") return null;
    if (trimmed.length > 1024 * 1024) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const sanitized = this.walk(parsed, depth + 1);
    try {
      return JSON.stringify(sanitized);
    } catch {
      return null;
    }
  }

  private truncate(s: string): string {
    if (Buffer.byteLength(s, "utf8") > this.maxBytes) {
      return s.slice(0, this.maxBytes) + "…[TRUNCATED]";
    }
    return s;
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
