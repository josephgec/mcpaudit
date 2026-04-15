import { loadConfig } from "../config.js";
import { buildEngine } from "../bootstrap.js";
import { runStdioProxy } from "../../proxy/stdio-proxy.js";
import { runSseProxy } from "../../proxy/sse-proxy.js";
import { runMultiplexStdioProxy } from "../../proxy/multiplexer.js";
import { startDashboard } from "../../dashboard/server.js";
import { AlertEngine } from "../../alerts/engine.js";
import { RetentionScheduler } from "../../compliance/retention.js";
import { CloudForwarder } from "../../cloud/forwarder.js";

export interface StartOptions {
  config: string;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const cfg = loadConfig(opts.config);
  const engine = await buildEngine(cfg);

  // Dashboard (Phase 2.1) — runs alongside the proxy.
  let dashboardHandle: { close: () => Promise<void> } | undefined;
  if (cfg.dashboard?.enabled !== false) {
    dashboardHandle = await startDashboard(engine, cfg);
    const host = cfg.dashboard?.host ?? "127.0.0.1";
    const port = cfg.dashboard?.port ?? 3101;
    logInfo(`dashboard:  http://${host}:${port}`);
  }

  // Alerting (Phase 2.2)
  const alertEngine = new AlertEngine(cfg.alerts ?? [], engine.storageRef);
  alertEngine.start();

  // Retention (Phase 3.3)
  const retention = new RetentionScheduler(
    engine.storageRef,
    cfg.logging.retention_days ?? 0,
  );
  retention.start();

  // Cloud forwarder (Phase 4)
  const cloud = new CloudForwarder(cfg.cloud);
  if (cloud.enabled) {
    engine.onAppend((r) => void cloud.forward(r));
    logInfo(`cloud:      forwarding to ${cfg.cloud!.ingest_url}`);
  }

  // Proxy — stdio is silent on stdout, so log only to stderr.
  let proxyHandle: { close: () => Promise<void> };
  if (cfg.upstreams && cfg.upstreams.length > 0) {
    proxyHandle = await runMultiplexStdioProxy({
      upstreams: cfg.upstreams,
      logEngine: engine,
      identity: cfg.identity,
    });
    logInfo(
      `proxy:      stdio multiplex over ${cfg.upstreams.length} upstreams`,
    );
  } else if (cfg.proxy.transport === "stdio") {
    proxyHandle = await runStdioProxy({
      upstream: cfg.upstream!,
      logEngine: engine,
      identity: cfg.identity,
    });
    logInfo(`proxy:      stdio -> ${cfg.upstream!.name}`);
  } else {
    proxyHandle = await runSseProxy({
      proxy: cfg.proxy,
      upstream: cfg.upstream!,
      logEngine: engine,
      identity: cfg.identity,
    });
    const host = cfg.proxy.listen?.host ?? "127.0.0.1";
    const port = cfg.proxy.listen?.port ?? 3100;
    logInfo(`proxy:      http://${host}:${port}/sse -> ${cfg.upstream!.name}`);
  }

  const shutdown = async () => {
    logInfo("shutting down...");
    alertEngine.stop();
    retention.stop();
    try {
      await proxyHandle.close();
    } catch {}
    if (dashboardHandle) {
      try {
        await dashboardHandle.close();
      } catch {}
    }
    await engine.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function logInfo(msg: string): void {
  process.stderr.write(`[mcpaudit] ${msg}\n`);
}
