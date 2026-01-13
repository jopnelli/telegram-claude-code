/**
 * Security module - user allowlist, path validation, audit logging
 */

import { resolve, normalize } from "path";
import { appendFileSync, realpathSync } from "fs";
import { ALLOWED_USERS, ALLOWED_PATHS, AUDIT_LOG } from "./config";
import type { AuditEntry } from "./types";

/**
 * Check if a Telegram user ID is authorized
 */
export function isAuthorized(userId: number | undefined): boolean {
  if (!userId) return false;
  return ALLOWED_USERS.includes(userId);
}

/**
 * Check if a file path is allowed for Claude to access
 */
export function isPathAllowed(targetPath: string): boolean {
  try {
    // Expand ~ and normalize
    const expanded = targetPath.replace(/^~/, process.env.HOME || "");
    const normalized = normalize(expanded);

    // Try to resolve symlinks
    let resolved: string;
    try {
      resolved = realpathSync(normalized);
    } catch {
      resolved = resolve(normalized);
    }

    // Check against allowed paths
    for (const allowed of ALLOWED_PATHS) {
      const allowedResolved = resolve(allowed);
      if (
        resolved === allowedResolved ||
        resolved.startsWith(allowedResolved + "/")
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Write an entry to the audit log
 */
export function auditLog(entry: Omit<AuditEntry, "timestamp">): void {
  const fullEntry: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  try {
    appendFileSync(AUDIT_LOG, JSON.stringify(fullEntry) + "\n");
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}
