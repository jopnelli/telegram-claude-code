/**
 * Text message handler - spawns actual Claude Code CLI using Bun subprocess
 */

import type { Context } from "grammy";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, clearSession, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { WORKING_DIR, ALLOWED_PATHS, CLAUDE_TIMEOUT_MS, DISALLOWED_TOOLS } from "../config";

/**
 * Get disallowed tools for CLI flag
 */
function getDisallowedTools(): string[] {
  return DISALLOWED_TOOLS;
}

/**
 * Minimal environment for Claude CLI subprocess
 * Only includes what's necessary - no API keys or sensitive data
 */
function getClaudeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin",
    HOME: process.env.HOME || "",
    USER: process.env.USER || "",
    SHELL: process.env.SHELL || "/bin/sh",
    TERM: "dumb",
    FORCE_COLOR: "0",
    // Claude CLI uses its own OAuth, not API keys
  };
}

/**
 * Run Claude CLI and return results
 */
async function runClaude(
  args: string[],
  streaming: StreamingState,
  timeoutMs: number,
): Promise<{ exitCode: number; responseText: string; stderrText: string; newSessionId: string | null }> {
  console.log("Spawning claude with args:", args.join(" "));

  const proc = Bun.spawn(["claude", ...args], {
    cwd: WORKING_DIR,
    env: getClaudeEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });

  let responseText = "";
  let currentTool = "";
  let newSessionId: string | null = null;

  const timeoutId = setTimeout(() => {
    console.log(`Claude process timed out after ${timeoutMs}ms`);
    proc.kill();
  }, timeoutMs);

  try {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          // Capture session ID
          if (event.session_id && !newSessionId) {
            newSessionId = event.session_id;
          }

          // Handle assistant messages
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text" && block.text) {
                responseText = block.text;
                await streaming.update(currentTool + responseText);
              }
              if (block.type === "tool_use") {
                const toolName = block.name || "tool";
                let detail = "";
                if (block.input?.file_path) detail = block.input.file_path;
                else if (block.input?.command) detail = block.input.command.slice(0, 40);
                else if (block.input?.pattern) detail = block.input.pattern;
                else if (block.input?.query) detail = block.input.query;

                currentTool = detail ? `[${toolName}: ${detail}]\n` : `[${toolName}]\n`;
                await streaming.update(currentTool + responseText);
              }
            }
          }

          // Handle tool results (clear tool indicator)
          if (event.type === "user" && event.tool_use_result) {
            currentTool = "";
            await streaming.update(responseText);
          }

          // Handle final result
          if (event.type === "result" && event.result) {
            responseText = event.result;
            currentTool = "";
            await streaming.update(responseText);
          }
        } catch (e) {
          // Not JSON, ignore
        }
      }
    }

    const exitCode = await proc.exited;
    console.log("Claude exited with code:", exitCode);

    // Read stderr
    const stderrReader = proc.stderr.getReader();
    const { value: stderrValue } = await stderrReader.read();
    const stderrText = stderrValue ? decoder.decode(stderrValue) : "";
    if (stderrText) {
      console.error("Claude stderr:", stderrText);
    }

    return { exitCode, responseText, stderrText, newSessionId };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle incoming text messages by spawning Claude CLI
 */
export async function handleText(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!isAuthorized(userId) || !chatId) {
    await ctx.reply("Unauthorized.");
    return;
  }

  let text = ctx.message?.text || "";

  // Handle ! prefix for interrupt
  if (text.startsWith("!")) {
    const session = getSession(userId!);
    if (session.isProcessing) {
      // Will implement interrupt later
    }
    text = text.slice(1).trim();
    if (!text) return;
  }

  // Wiedervorlage v3: prepend reply context so the session can bind the answer to an item
  const replyTo = ctx.message?.reply_to_message;
  if (replyTo && (replyTo.text || replyTo.caption)) {
    const quotedFull = (replyTo.text || replyTo.caption || "").replace(/\"/g, "'");
    const quoted = quotedFull.length > 160 ? quotedFull.slice(0, 160) + "…" : quotedFull;
    text = `[Antwort auf Nachricht ${replyTo.message_id}: "${quoted}"]\n${text}`;
  }

  const session = getSession(userId!);

  if (session.isProcessing) {
    await ctx.reply("Still processing. Send ! to interrupt.");
    return;
  }

  auditLog({
    userId: userId!,
    username: ctx.from?.username,
    action: "message",
    details: text.slice(0, 100),
  });

  session.isProcessing = true;
  const streaming = new StreamingState(ctx.api, chatId);

  // Send typing indicator periodically (expires after ~5s)
  const sendTyping = () => ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  await sendTyping();
  const typingInterval = setInterval(sendTyping, 4000);

  // Build CLI arguments
  const SYSTEM_PROMPT = [
    "You are responding via Telegram. Do NOT use Markdown formatting (no **, no ## headers, no `backticks`, no [links](url)). Use plain text only. Use line breaks and emoji for structure instead.",
    "IMPORTANT: When the user asks you to send a file, do NOT paste the file contents. Instead, use the send-file script to deliver it as a Telegram file attachment:",
    "  ~/bin/telegram-send-file.sh <filepath> [caption]",
    "This sends the actual file as a document in Telegram. Always use this for sending files.",
    "",
    "WIEDERVORLAGE (v3): Daily pings are one header plus one message per decision; the morning routine session is handed off to this bot, so answers normally land in that session. Replies may carry a prefixed line [Antwort auf Nachricht <msg_id>: ...] - resolve the item by matching msg_id against ping.msg_id in System/wiedervorlage/items.json. Without reply context, resolve the item from the wording; if ambiguous, ask back, never guess. Semantics and hard rules: ~/tools/wiedervorlage/CONTRACT.md, section Antworten (ja/nein/text/kontext/spaeter/still/delegier/queue; nothing externally visible without a yes bound to the item; after an external send, send the exact wording as proof). Before executing: cd ~/obsidian && git pull --rebase --autostash. After changes: update System/wiedervorlage/items.json, validate via python3 ~/tools/wiedervorlage/scripts/validate.py --state System/wiedervorlage/items.json, append journal events (python3 ~/tools/wiedervorlage/scripts/journal.py --journal System/wiedervorlage/journal.jsonl add ...), then commit and push. The old Google Doc is retired; never read or write it.",
  ].join("\n");

  const args = ["-p", text, "--output-format", "stream-json", "--verbose", "--append-system-prompt", SYSTEM_PROMPT];

  // Add allowed directories for file access
  for (const allowedPath of ALLOWED_PATHS) {
    args.push("--add-dir", allowedPath);
  }

  // Add safety restrictions (block dangerous commands)
  const disallowed = getDisallowedTools();
  if (disallowed.length > 0) {
    args.push("--disallowed-tools", disallowed.join(" "));
  }

  if (session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  try {
    let result = await runClaude(args, streaming, CLAUDE_TIMEOUT_MS);

    // If --resume failed (stale session), retry without it
    if (
      result.exitCode !== 0 &&
      !result.responseText &&
      session.sessionId &&
      (result.stderrText.includes("No conversation found") ||
       result.stderrText.includes("session") ||
       result.exitCode === 1)
    ) {
      console.log("Resume failed, retrying without --resume");
      clearSession(userId!);

      // Remove --resume args and retry
      const freshArgs = args.filter(
        (arg, i) => arg !== "--resume" && (i === 0 || args[i - 1] !== "--resume")
      );

      // Create fresh streaming state (old one may have no message yet)
      result = await runClaude(freshArgs, streaming, CLAUDE_TIMEOUT_MS);
    }

    await streaming.finalize();

    // If still no response after retry, tell the user
    if (!result.responseText) {
      await ctx.reply("Claude didn't produce a response. Try again or send /new to start fresh.");
    }

    if (result.newSessionId) {
      setSessionId(userId!, result.newSessionId);
    }

    auditLog({
      userId: userId!,
      action: "response",
      details: `${result.responseText.length} chars`,
    });

  } catch (err: any) {
    console.error("Claude error:", err);
    await ctx.reply(`Error: ${err.message || "Unknown error"}`);
    auditLog({ userId: userId!, action: "error", details: err.message || "unknown" });
  } finally {
    clearInterval(typingInterval);
    session.isProcessing = false;
    session.currentMessageId = streaming.getMessageId();
    persistSession(userId!, session);
  }
}
