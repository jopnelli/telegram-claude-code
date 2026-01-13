/**
 * Configuration module for Telegram Claude Code Bot
 */

import { resolve } from "path";

// Required environment variables
export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// User allowlist
export const ALLOWED_USERS: number[] = (process.env.TELEGRAM_ALLOWED_USERS || "")
  .split(",")
  .map((id) => parseInt(id.trim()))
  .filter((id) => !isNaN(id));

// Paths
export const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "/path/to/working/directory";
export const SESSION_DIR = process.env.SESSION_DIR || resolve(import.meta.dir, "../../data/sessions");
export const AUDIT_LOG = process.env.AUDIT_LOG || "/tmp/telegram-claude-code-audit.log";

// Allowed paths for Claude to access
export const ALLOWED_PATHS: string[] = (
  process.env.ALLOWED_PATHS || "/path/to/working/directory,/path/to/workspace,/tmp"
)
  .split(",")
  .map((p) => p.trim());

// Claude configuration
export const CLAUDE_MODEL = "claude-opus-4-5-20251101";

// Telegram limits
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const STREAMING_THROTTLE_MS = 300;

// Validate required config
if (!TELEGRAM_TOKEN) {
  console.error("Error: TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

if (ALLOWED_USERS.length === 0) {
  console.error("Error: TELEGRAM_ALLOWED_USERS not set");
  process.exit(1);
}

console.log("Config loaded:");
console.log(`  Working dir: ${WORKING_DIR}`);
console.log(`  Allowed users: ${ALLOWED_USERS.length}`);
console.log(`  Allowed paths: ${ALLOWED_PATHS.length}`);
