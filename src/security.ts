/**
 * Security module - user allowlist and audit logging
 *
 * Note: Path restrictions are enforced via Claude CLI's --add-dir flag.
 * For additional protection against dangerous commands, consider installing
 * the claude-code-safety-net plugin: https://github.com/kenryu42/claude-code-safety-net
 */

import { appendFileSync } from "fs";
import { resolve } from "path";
import { ALLOWED_USERS, AUDIT_LOG, ALLOWED_PATHS, WORKING_DIR } from "./config";
import type { AuditEntry } from "./types";

/**
 * Check if a Telegram user ID is authorized
 */
export function isAuthorized(userId: number | undefined): boolean {
  if (!userId) return false;
  return ALLOWED_USERS.includes(userId);
}

/**
 * Check if a path is within allowed directories
 * Used by /send command to restrict file access
 */
export function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);

  // Always allow working directory
  if (resolved.startsWith(resolve(WORKING_DIR))) {
    return true;
  }

  // Check against allowed paths
  for (const allowed of ALLOWED_PATHS) {
    if (resolved.startsWith(resolve(allowed))) {
      return true;
    }
  }

  return false;
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
