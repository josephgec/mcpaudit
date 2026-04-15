export type Transport = "stdio" | "sse";

export type StorageKind = "sqlite" | "postgres";

export interface UpstreamStdio {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface UpstreamRemote {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export type UpstreamConfig = UpstreamStdio | UpstreamRemote;

export function isStdioUpstream(u: UpstreamConfig): u is UpstreamStdio {
  return "command" in u && typeof (u as UpstreamStdio).command === "string";
}

export interface ProxyConfig {
  transport: Transport;
  listen?: { host?: string; port?: number };
}

export interface SanitizationConfig {
  redact_fields?: string[];
  max_field_size_kb?: number;
  pii?: {
    enabled: boolean;
    mode: "redact" | "hash" | "allow";
    detectors?: Array<"email" | "phone" | "ssn" | "credit_card" | "ip">;
  };
}

export interface LoggingConfig {
  storage: StorageKind;
  path?: string;
  rotation?: "daily" | "size";
  rotation_size_mb?: number;
  retention_days?: number;
  postgres?: { connectionString: string };
}

export interface IdentityConfig {
  source: "config" | "header" | "oauth";
  default_user?: string;
  header_name?: string;
}

export interface AlertRule {
  name: string;
  condition: string;
  action: "webhook" | "log" | "log_warning";
  url?: string;
}

export interface DashboardAuthUser {
  username: string;
  role: "admin" | "auditor" | "viewer";
  password_hash: string;
}

export interface DashboardConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  auth?: {
    enabled: boolean;
    users?: DashboardAuthUser[];
    jwt_secret?: string;
  };
}

export interface CloudConfig {
  enabled: boolean;
  ingest_url?: string;
  api_key?: string;
}

export interface Config {
  proxy: ProxyConfig;
  upstream?: UpstreamConfig;
  upstreams?: UpstreamConfig[];
  logging: LoggingConfig;
  sanitization?: SanitizationConfig;
  identity?: IdentityConfig;
  alerts?: AlertRule[];
  dashboard?: DashboardConfig;
  cloud?: CloudConfig;
}
