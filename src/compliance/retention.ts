import type { Storage } from "../logging/storage/interface.js";

/**
 * Periodic retention purger. Runs once on start and then every 6h.
 * A retentionDays of 0 or undefined disables enforcement.
 */
export class RetentionScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private storage: Storage,
    private retentionDays: number,
  ) {}

  start(): void {
    if (!this.retentionDays || this.retentionDays <= 0) return;
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), 6 * 60 * 60 * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<number> {
    try {
      const cutoff = new Date(
        Date.now() - this.retentionDays * 86_400_000,
      ).toISOString();
      const n = await Promise.resolve(this.storage.purgeOlderThan(cutoff));
      if (n > 0) {
        process.stderr.write(
          `[mcpaudit] retention: purged ${n} record batches older than ${cutoff}\n`,
        );
      }
      return n;
    } catch (e) {
      process.stderr.write(
        `[mcpaudit] retention error: ${
          e instanceof Error ? e.message : String(e)
        }\n`,
      );
      return 0;
    }
  }
}
