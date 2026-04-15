import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { Config } from "../types.js";

export function loadConfig(path: string): Config {
  const abs = resolve(path);
  const text = readFileSync(abs, "utf8");
  const parsed = yaml.load(text) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`config ${abs} is not a valid YAML object`);
  }
  const cfg = parsed as Config;
  validateConfig(cfg, abs);
  return cfg;
}

function validateConfig(cfg: Config, path: string): void {
  if (!cfg.proxy) {
    throw new Error(`${path}: missing "proxy" section`);
  }
  if (cfg.proxy.transport !== "stdio" && cfg.proxy.transport !== "sse") {
    throw new Error(
      `${path}: proxy.transport must be "stdio" or "sse"`,
    );
  }
  const hasUpstream = !!cfg.upstream;
  const hasUpstreams = Array.isArray(cfg.upstreams) && cfg.upstreams.length > 0;
  if (!hasUpstream && !hasUpstreams) {
    throw new Error(
      `${path}: must define either "upstream" or "upstreams"`,
    );
  }
  if (!cfg.logging) {
    throw new Error(`${path}: missing "logging" section`);
  }
  if (cfg.logging.storage !== "sqlite" && cfg.logging.storage !== "postgres") {
    throw new Error(
      `${path}: logging.storage must be "sqlite" or "postgres"`,
    );
  }
}
