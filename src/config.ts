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

// What this instance is for, as a file appended to the system prompt. Unset keeps
// the built-in Wiedervorlage context, so a second bot (own token, own service)
// can be a different assistant without a fork.
export const INSTANCE_PROMPT_FILE = process.env.INSTANCE_PROMPT_FILE || "";

// Env file the send-file script reads. Passed into the subprocess so a file goes
// out through this instance's bot, not through another instance's.
export const BOT_ENV_FILE = process.env.TELEGRAM_BOT_ENV_FILE || "";

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

/**
 * Environment for the Claude CLI subprocess. Deliberately minimal: the bot's own
 * environment holds the bot token, so nothing is inherited that is not needed.
 * TELEGRAM_BOT_ENV_FILE is a path, not a secret, and only travels so that
 * telegram-send-file.sh answers through this instance's bot.
 */
export function claudeEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin",
    HOME: process.env.HOME || "",
    USER: process.env.USER || "",
    SHELL: process.env.SHELL || "/bin/sh",
    TERM: "dumb",
    FORCE_COLOR: "0",
    // Claude CLI uses its own OAuth, not API keys
  };

  if (BOT_ENV_FILE) env.TELEGRAM_BOT_ENV_FILE = BOT_ENV_FILE;

  return env;
}

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
console.log(`  Instance prompt: ${INSTANCE_PROMPT_FILE || "built-in (Wiedervorlage)"}`);
