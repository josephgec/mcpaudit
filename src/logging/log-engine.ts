import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();
import type { AuditRecord } from "./schema.js";
import { computeContentHash } from "./hash-chain.js";
import { Sanitizer } from "./sanitize.js";
import type { Storage } from "./storage/interface.js";
import type { SanitizationConfig } from "../types.js";

export interface RecordInput {
  correlationId?: string;
  sessionId: string;
  serverName: string;
  toolName: string;
  method: string;
  inputParams: unknown;
  outputData: unknown;
  isError: boolean;
  errorMessage?: string;
  startedAt: Date;
  completedAt: Date;
  userIdentity?: string;
  clientInfo?: Record<string, unknown>;
  estimatedCostUsd?: number;
}

/**
 * LogEngine centralizes all writes to storage. It:
 *   1. Generates a ULID id
 *   2. Sanitizes input/output per config
 *   3. Computes the content hash chained off the last record's hash
 *   4. Appends to storage
 *
 * Writes are enqueued and flushed serially to guarantee a single authoritative
 * hash chain even under concurrent callers.
 */
export class LogEngine {
  private queue: Array<() => Promise<void>> = [];
  private draining = false;
  private sanitizer: Sanitizer;
  private listeners = new Set<(r: AuditRecord) => void>();

  constructor(
    private storage: Storage,
    sanitization: SanitizationConfig | undefined,
  ) {
    this.sanitizer = new Sanitizer(sanitization);
  }

  async init(): Promise<void> {
    await this.storage.init();
  }

  onAppend(listener: (r: AuditRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Enqueues a record for sequential append. Resolves once written. */
  record(input: RecordInput): Promise<AuditRecord> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const rec = await this.buildAndWrite(input);
          resolve(rec);
        } catch (e) {
          reject(e);
        }
      });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        await task();
      }
    } finally {
      this.draining = false;
    }
  }

  private async buildAndWrite(input: RecordInput): Promise<AuditRecord> {
    const id = ulid();
    const sanitizedInput = this.sanitizer.sanitize(input.inputParams);
    const sanitizedOutput = this.sanitizer.sanitize(input.outputData);

    const previous = await Promise.resolve(this.storage.getLastHash());

    const base: Omit<AuditRecord, "contentHash" | "previousHash"> = {
      id,
      correlationId: input.correlationId ?? id,
      sessionId: input.sessionId,
      serverName: input.serverName,
      toolName: input.toolName,
      method: input.method,
      inputParams: sanitizedInput,
      outputData: sanitizedOutput,
      isError: input.isError,
      errorMessage: input.errorMessage,
      startedAt: input.startedAt.toISOString(),
      completedAt: input.completedAt.toISOString(),
      latencyMs: input.completedAt.getTime() - input.startedAt.getTime(),
      userIdentity: input.userIdentity,
      clientInfo: input.clientInfo,
      estimatedCostUsd: input.estimatedCostUsd,
    };
    const contentHash = computeContentHash(base, previous);
    const record: AuditRecord = {
      ...base,
      contentHash,
      previousHash: previous,
    };
    await Promise.resolve(this.storage.append(record));
    for (const l of this.listeners) {
      try {
        l(record);
      } catch {}
    }
    return record;
  }

  get storageRef(): Storage {
    return this.storage;
  }

  async close(): Promise<void> {
    // Drain then close
    await this.drain();
    await Promise.resolve(this.storage.close());
  }
}
