import { ulid } from "ulid";
import type { LogEngine } from "../logging/log-engine.js";
import type { IdentityConfig } from "../types.js";

/**
 * ProxySession holds per-connection state (sessionId, correlation tracking,
 * client info). One instance per upstream connection.
 */
export class ProxySession {
  readonly sessionId: string = ulid();
  clientInfo?: Record<string, unknown>;
  userIdentity?: string;

  constructor(
    public readonly serverName: string,
    public readonly logEngine: LogEngine,
    identity: IdentityConfig | undefined,
  ) {
    this.userIdentity = identity?.default_user;
  }

  /**
   * Wraps an upstream call so that its input/output/latency is logged.
   * Exceptions and error responses are captured as isError=true records
   * and then rethrown.
   */
  async recordCall<T>(
    method: string,
    toolName: string,
    inputParams: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await fn();
      const completedAt = new Date();
      const isError = detectIsError(result);
      await this.logEngine.record({
        sessionId: this.sessionId,
        serverName: this.serverName,
        toolName,
        method,
        inputParams,
        outputData: result,
        isError,
        errorMessage: isError ? extractErrorMessage(result) : undefined,
        startedAt,
        completedAt,
        clientInfo: this.clientInfo,
        userIdentity: this.userIdentity,
      });
      return result;
    } catch (err) {
      const completedAt = new Date();
      const message = err instanceof Error ? err.message : String(err);
      await this.logEngine.record({
        sessionId: this.sessionId,
        serverName: this.serverName,
        toolName,
        method,
        inputParams,
        outputData: null,
        isError: true,
        errorMessage: message,
        startedAt,
        completedAt,
        clientInfo: this.clientInfo,
        userIdentity: this.userIdentity,
      });
      throw err;
    }
  }
}

function detectIsError(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as { isError?: unknown };
  return r.isError === true;
}

function extractErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  if (Array.isArray(r.content)) {
    const first = r.content.find((c) => c && c.type === "text" && c.text);
    if (first?.text) return first.text;
  }
  return undefined;
}
