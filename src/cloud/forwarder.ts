import type { AuditRecord } from "../logging/schema.js";
import type { CloudConfig } from "../types.js";

/**
 * Client-side cloud log forwarder. Ships audit records to a hosted ingest
 * endpoint (mcpaudit-cloud, a separate private repo).
 *
 * Design goals:
 *   - Non-blocking: forwarding must never slow down the local write path.
 *   - Batched: buffer records and flush every flushIntervalMs or when the
 *     buffer hits maxBatchSize, whichever comes first.
 *   - Resilient: on failure, records are dropped rather than retained in
 *     memory indefinitely — local storage is still the source of truth.
 *
 * The server-side ingest endpoint, auth, billing, multi-tenant storage,
 * and managed dashboard all live in the private mcpaudit-cloud repo.
 * This class is the thin client-side boundary.
 */
export class CloudForwarder {
  readonly enabled: boolean;
  private buffer: AuditRecord[] = [];
  private flushing = false;
  private timer: NodeJS.Timeout | null = null;
  private maxBatchSize = 100;
  private flushIntervalMs = 5_000;

  constructor(private cfg: CloudConfig | undefined) {
    this.enabled = !!cfg?.enabled && !!cfg?.ingest_url && !!cfg?.api_key;
    if (this.enabled) {
      this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
      this.timer.unref?.();
    }
  }

  forward(record: AuditRecord): void {
    if (!this.enabled) return;
    this.buffer.push(record);
    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0 || !this.enabled) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, this.maxBatchSize);
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(this.cfg!.ingest_url!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg!.api_key}`,
          "x-mcpaudit-client": "mcpaudit/0.1.0",
        },
        body: JSON.stringify({ records: batch }),
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        process.stderr.write(
          `[mcpaudit] cloud ingest non-OK ${res.status}, dropping ${batch.length} records\n`,
        );
      }
    } catch (e) {
      process.stderr.write(
        `[mcpaudit] cloud ingest error (${
          e instanceof Error ? e.message : String(e)
        }), dropping ${batch.length} records\n`,
      );
    } finally {
      this.flushing = false;
    }
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    void this.flush();
  }
}
