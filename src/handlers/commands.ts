/**
 * Command handlers for /new, /stop, /status, /resume
 */

import type { Context } from "grammy";
import { isAuthorized, auditLog } from "../security";
import { getSession, clearSession, loadPersistedSession, setSessionId } from "../session";
import { WORKING_DIR } from "../config";

/**
 * /start - Welcome message
 */
export async function handleStart(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId)) {
    await ctx.reply("Unauthorized.");
    auditLog({ userId: userId || 0, action: "unauthorized", details: "/start" });
    return;
  }

  await ctx.reply(
    "Claude Code Bot ready.\n\n" +
    "Send me messages to chat with Claude Code.\n" +
    "Your conversation persists across messages.\n\n" +
    "Commands:\n" +
    "/new - Start fresh session\n" +
    "/stop - Abort current query\n" +
    "/status - Check if processing\n" +
    "/resume - Resume after restart\n" +
    "/send <path> - Send file from working dir\n\n" +
    "Prefix with ! to interrupt."
  );
}

/**
 * The reset behind /new: drop the session so the next message opens a fresh one.
 * Shared with the automatic rotation, so both paths clear the same state.
 */
export function resetSession(userId: number, details: string): void {
  clearSession(userId);
  auditLog({ userId, action: "new_session", details });
}

/**
 * /new - Start a fresh session
 */
export async function handleNew(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  resetSession(userId!, "Cleared session");

  await ctx.reply("Started a new session. Previous context cleared.");
}

/**
 * /stop - Abort current query
 */
export async function handleStop(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const session = getSession(userId!);

  if (session.abortController && session.isProcessing) {
    session.abortController.abort();
    auditLog({ userId: userId!, action: "stop", details: "Aborted query" });
    await ctx.reply("Stopping current query...");
  } else {
    await ctx.reply("No query in progress.");
  }
}

/**
 * /status - Check processing state
 */
export async function handleStatus(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const session = getSession(userId!);

  let status = "Idle, ready for messages.";
  if (session.isProcessing) {
    status = "Processing a query...";
  }

  const sessionInfo = session.sessionId
    ? `\nSession: ${session.sessionId.slice(0, 8)}...`
    : "\nNo active session.";

  await ctx.reply(`Status: ${status}${sessionInfo}\nWorking dir: ${WORKING_DIR}`);
}

/**
 * /resume - Resume last session after restart
 */
export async function handleResume(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const persisted = loadPersistedSession(userId!);

  if (persisted) {
    setSessionId(userId!, persisted.sessionId);
    const date = new Date(persisted.lastActivity).toLocaleString();
    auditLog({ userId: userId!, action: "resume", details: `Session from ${date}` });
    await ctx.reply(`Resumed session from ${date}`);
  } else {
    await ctx.reply("No previous session found.");
  }
}
