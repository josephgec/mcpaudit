import type { IncomingMessage } from "node:http";
import bcrypt from "bcrypt";
import type { DashboardConfig, DashboardAuthUser } from "../types.js";
import { DashboardAuthError } from "./server.js";

export type Role = "admin" | "auditor" | "viewer";

export interface AuthContext {
  required: boolean;
  ok: boolean;
  user?: DashboardAuthUser;
}

/**
 * Basic-auth against the users defined in dashboard.auth.users.
 * When auth is disabled, returns { required:false, ok:true }.
 * Bcrypt-hashed passwords; constant-time equality via bcrypt.compareSync.
 */
export function authenticate(
  req: IncomingMessage,
  cfg: DashboardConfig | undefined,
): AuthContext {
  if (!cfg?.auth?.enabled) {
    return { required: false, ok: true };
  }
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Basic ")) {
    return { required: true, ok: false };
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return { required: true, ok: false };
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  const user = (cfg.auth.users ?? []).find((u) => u.username === username);
  if (!user) return { required: true, ok: false };
  try {
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return { required: true, ok: false };
    }
  } catch {
    return { required: true, ok: false };
  }
  return { required: true, ok: true, user };
}

export function requireRole(auth: AuthContext, allowed: Role[]): void {
  if (!auth.required) return;
  if (!auth.ok || !auth.user) {
    throw new DashboardAuthError("unauthorized");
  }
  if (!allowed.includes(auth.user.role)) {
    throw new DashboardAuthError(
      `forbidden: role ${auth.user.role} cannot access this resource`,
    );
  }
}
