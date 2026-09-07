/**
 * Automatic session rotation
 *
 * A session carries a transcript that is re-read on every message, and one
 * picked up days later answers from context nobody means anymore. The fix in
 * both cases is what /new does, so the bridge does it itself before handling a
 * message instead of waiting for the user to notice. So the cut is not felt
 * mid-conversation, the size-based rotation waits for a quiet gap, and the
 * last exchange of the old session is handed into the fresh one.
 */

import { readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Context, NextFunction } from "grammy";
import {
  HARD_MAX_TRANSCRIPT_BYTES,
  MAX_SESSION_IDLE_MS,
  MAX_TRANSCRIPT_BYTES,
  MIN_ROTATION_QUIET_MS,
  WORKING_DIR,
} from "./config";
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
    // Over the soft limit the rotation waits for a quiet gap so it never cuts
    // a conversation in progress; the hard ceiling rotates regardless
    const quiet = Date.now() - session.lastActivity.getTime();
    if (bytes > HARD_MAX_TRANSCRIPT_BYTES || quiet >= MIN_ROTATION_QUIET_MS) {
      return {
        reason: `transcript ${bytes} bytes`,
        notice:
          "♻️ Frische Session gestartet (Kontext war voll). Deine Dateien gelten weiter, der Chat-Verlauf nicht.",
      };
    }
  }

  return null;
}

// A snippet longer than this says nothing more, it only bloats the prompt
const HANDOVER_SNIPPET_CHARS = 1000;

/**
 * Context handed from the rotated-away session into the fresh one: the last
 * user and assistant text from the old transcript, marked as system context.
 * The .jsonl mixes turn records with tool results, thinking blocks and
 * bookkeeping entries (ai-title, attachment, last-prompt, ...); only two
 * shapes count here: user entries whose message.content is a plain string
 * (tool results come as arrays, injected context carries isMeta), and
 * assistant entries with a text block. Anything unreadable means no handover,
 * never an error: the rotation itself must go through.
 */
function buildHandover(sessionId: string): string | null {
  try {
    const lines = readFileSync(transcriptPath(sessionId), "utf-8").split("\n");
    let lastUser: string | null = null;
    let lastAssistant: string | null = null;

    for (let i = lines.length - 1; i >= 0 && !(lastUser && lastAssistant); i--) {
      let entry: any;
      try {
        entry = JSON.parse(lines[i]!);
      } catch {
        continue;
      }

      if (!lastAssistant && entry?.type === "assistant" && Array.isArray(entry.message?.content)) {
        const text = entry.message.content
          .filter((block: any) => block?.type === "text" && typeof block.text === "string")
          .map((block: any) => block.text)
          .join("\n")
          .trim();
        if (text) lastAssistant = text;
      }

      if (!lastUser && entry?.type === "user" && !entry.isMeta && typeof entry.message?.content === "string") {
        const text = entry.message.content.trim();
        if (text) lastUser = text;
      }
    }

    if (!lastUser && !lastAssistant) return null;

    const clip = (text: string) =>
      text.length > HANDOVER_SNIPPET_CHARS ? text.slice(0, HANDOVER_SNIPPET_CHARS) + "…" : text;

    const parts = ["[Automatische Session-Rotation. Letzter Wortwechsel der vorherigen Session, nur als Kontext:"];
    if (lastUser) parts.push(`User: ${clip(lastUser)}`);
    if (lastAssistant) parts.push(`Du: ${clip(lastAssistant)}`);
    return parts.join("\n") + "]";
  } catch {
    return null;
  }
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
        const oldSessionId = getSession(userId!).sessionId;
        const handover = oldSessionId ? buildHandover(oldSessionId) : null;
        resetSession(userId!, `Auto-rotated, ${rotation.reason}`);
        // The fresh session carries the old tail until the next prompt uses it
        if (handover) getSession(userId!).pendingHandover = handover;
        await ctx.reply(rotation.notice);
      }
    } catch (err) {
      // A failed check must not swallow the message, the old session still works
      console.error("Session rotation check failed:", err);
    }
  }

  await next();
}
