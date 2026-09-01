/**
 * Automatic session rotation
 *
 * A session carries a transcript that is re-read on every message, and one
 * picked up days later answers from context nobody means anymore. The fix in
 * both cases is what /new does, so the bridge does it itself before handling a
 * message instead of waiting for the user to notice.
 */

import { statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Context, NextFunction } from "grammy";
import { MAX_SESSION_IDLE_MS, MAX_TRANSCRIPT_BYTES, WORKING_DIR } from "./config";
import { getSession } from "./session";
import { isAuthorized } from "./security";
import { resetSession } from "./handlers/commands";

interface Rotation {
  /** Short reason, for the audit log */
  reason: string;
  /** One line telling the user why the thread starts over */
  notice: string;
}

/**
 * Claude Code keeps one transcript per session, under the working directory
 * with every "/" replaced by "-"
 */
function transcriptPath(sessionId: string): string {
  const slug = WORKING_DIR.replaceAll("/", "-");
  return join(homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
}

/**
 * Size of the session's transcript, or null when there is nothing to measure:
 * no transcript written yet, or the file is unreadable
 */
function transcriptBytes(sessionId: string): number | null {
  try {
    return statSync(transcriptPath(sessionId)).size;
  } catch {
    return null;
  }
}

/**
 * Whether this user's session has to be rotated before the next message
 */
function dueForRotation(userId: number): Rotation | null {
  const session = getSession(userId);

  // Nothing to rotate before the first answer, and never cut a running query
  if (!session.sessionId || session.isProcessing) return null;

  if (Date.now() - session.lastActivity.getTime() > MAX_SESSION_IDLE_MS) {
    return {
      reason: `idle since ${session.lastActivity.toISOString()}`,
      notice:
        "♻️ Frische Session gestartet (lange Pause). Deine Dateien gelten weiter, der Chat-Verlauf nicht.",
    };
  }

  const bytes = transcriptBytes(session.sessionId);
  if (bytes !== null && bytes > MAX_TRANSCRIPT_BYTES) {
    return {
      reason: `transcript ${bytes} bytes`,
      notice:
        "♻️ Frische Session gestartet (Kontext war voll). Deine Dateien gelten weiter, der Chat-Verlauf nicht.",
    };
  }

  return null;
}

/**
 * Rotate a stale or oversized session, then let the message through to be
 * handled in the fresh one. Commands are exempt: /new and /resume manage the
 * session themselves.
 */
export async function rotationGuard(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  const message = ctx.message;

  if (message && isAuthorized(userId) && !message.text?.startsWith("/")) {
    try {
      const rotation = dueForRotation(userId!);

      if (rotation) {
        console.log(`Rotating session for user ${userId}: ${rotation.reason}`);
        resetSession(userId!, `Auto-rotated, ${rotation.reason}`);
        await ctx.reply(rotation.notice);
      }
    } catch (err) {
      // A failed check must not swallow the message, the old session still works
      console.error("Session rotation check failed:", err);
    }
  }

  await next();
}
