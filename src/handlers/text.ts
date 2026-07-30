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
    "WIEDERVORLAGE PINGS: The daily 'Wiedervorlage <TT.MM.>:' ping is sent by the morning routine, whose session is handed off to this bot afterwards — so if you composed that ping, replies like 'ja <n>', 'verwerfen' or numbered answers refer to YOUR numbered list from the ping. If you did NOT compose today's ping, the numbers refer to that ping's list, never to any list from this conversation — do not answer from memory then. Either way, before executing: cd ~/obsidian && git pull --rebase --autostash, then read the current state: the Wiedervorlage Google Doc via  uv run --python 3.12 --with 'google-auth-oauthlib>=1.2,<2' --with 'google-api-python-client>=2.190,<3' python3 System/Scripts/google_docs.py read 1f_ROCgWRdrUXaxBS8PuepWQkDJ9exMrSc34b1YUyvFI  and today's entry in System/wiedervorlage-log.md. The doc item carries the full execution context (draft path, recipient, command); execute exactly what was approved. If items change as a result, update the doc: write the complete new markdown to /tmp/wiedervorlage-neu.md and run the same script with 'update' and that file instead of 'read'. Commit and push vault changes.",
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
