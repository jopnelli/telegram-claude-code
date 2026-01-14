/**
 * Configuration module for Telegram Claude Code Bot
 */

import { resolve } from "path";

// Required environment variables
export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// User allowlist
export const ALLOWED_USERS: number[] = (process.env.TELEGRAM_ALLOWED_USERS || "")
  .split(",")
  .map((id) => parseInt(id.trim()))
  .filter((id) => !isNaN(id));

// Paths - no defaults, must be configured
export const WORKING_DIR = process.env.CLAUDE_WORKING_DIR || "";
export const SESSION_DIR = process.env.SESSION_DIR || resolve(import.meta.dir, "../../data/sessions");
export const AUDIT_LOG = process.env.AUDIT_LOG || "/tmp/telegram-claude-code-audit.log";

// Allowed paths for Claude to access (used with --add-dir flag)
export const ALLOWED_PATHS: string[] = (process.env.ALLOWED_PATHS || "")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p.length > 0);

// Subprocess timeout (default: 5 minutes)
export const CLAUDE_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || "300000");

/**
 * Dangerous command patterns blocked via --disallowed-tools
 * Based on claude-code-safety-net patterns
 * Syntax: Bash(command:*) matches commands starting with that prefix
 */
export const DISALLOWED_TOOLS = [
  // Destructive file operations
  "Bash(rm -rf:*)",
  "Bash(rm -fr:*)",
  // Destructive git operations
  "Bash(git reset --hard:*)",
  "Bash(git reset --merge:*)",
  "Bash(git clean -f:*)",
  "Bash(git clean -fd:*)",
  "Bash(git clean -fx:*)",
  "Bash(git push --force:*)",  // use --force-with-lease instead
  "Bash(git push -f:*)",
  "Bash(git branch -D:*)",
  "Bash(git stash drop:*)",
  "Bash(git stash clear:*)",
  "Bash(git checkout -- :*)",  // file restoration
  // Destructive find operations
  "Bash(find*-delete:*)",
];

// Telegram limits
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export const STREAMING_THROTTLE_MS = 300;

// Validate required config
if (!TELEGRAM_TOKEN) {
  console.error("Error: TELEGRAM_BOT_TOKEN not set");
  process.exit(1);
}

if (ALLOWED_USERS.length === 0) {
  console.error("Error: TELEGRAM_ALLOWED_USERS not set");
  process.exit(1);
}

if (!WORKING_DIR) {
  console.error("Error: CLAUDE_WORKING_DIR not set");
  process.exit(1);
}

console.log("Config loaded:");
console.log(`  Working dir: ${WORKING_DIR}`);
console.log(`  Allowed users: ${ALLOWED_USERS.length}`);
console.log(`  Allowed paths: ${ALLOWED_PATHS.length}`);
console.log(`  Timeout: ${CLAUDE_TIMEOUT_MS}ms`);
console.log(`  Blocked patterns: ${DISALLOWED_TOOLS.length}`);
