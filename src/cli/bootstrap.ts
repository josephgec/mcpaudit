import { SqliteStorage } from "../logging/storage/sqlite.js";
import { LogEngine } from "../logging/log-engine.js";
import type { Config } from "../types.js";
import type { Storage } from "../logging/storage/interface.js";

/**
 * Constructs a Storage backend from config. Postgres lazy-loaded so that
 * installations without `pg` work fine for the default SQLite path.
 */
export async function buildStorage(cfg: Config): Promise<Storage> {
  if (cfg.logging.storage === "sqlite") {
    const storage = new SqliteStorage({
      dir: cfg.logging.path ?? "./audit-logs",
      rotation: cfg.logging.rotation ?? "daily",
      rotationSizeMb: cfg.logging.rotation_size_mb ?? 100,
      appendOnly: true,
    });
    storage.init();
    return storage;
  }
  if (cfg.logging.storage === "postgres") {
    if (!cfg.logging.postgres?.connectionString) {
      throw new Error("logging.postgres.connectionString is required");
    }
    const { PostgresStorage } = await import("../logging/storage/postgres.js");
    const storage = new PostgresStorage({
      connectionString: cfg.logging.postgres.connectionString,
    });
    await storage.init();
    return storage;
  }
  throw new Error(`unknown storage backend: ${cfg.logging.storage}`);
}

export async function buildEngine(cfg: Config): Promise<LogEngine> {
  const storage = await buildStorage(cfg);
  const engine = new LogEngine(storage, cfg.sanitization);
  await engine.init();
  return engine;
}
