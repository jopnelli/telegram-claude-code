/**
 * Text message handler - spawns actual Claude Code CLI using Bun subprocess
 */

import type { Context } from "grammy";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { WORKING_DIR, ALLOWED_PATHS, CLAUDE_TIMEOUT_MS, getDisallowedTools } from "../config";

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
  const args = ["-p", text, "--output-format", "stream-json", "--verbose"];

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

  let responseText = "";
  let currentTool = "";
  let newSessionId: string | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    console.log("Spawning claude with args:", args.join(" "));

    const proc = Bun.spawn(["claude", ...args], {
      cwd: WORKING_DIR,
      env: getClaudeEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    // Set up timeout to kill runaway processes
    timeoutId = setTimeout(() => {
      console.log(`Claude process timed out after ${CLAUDE_TIMEOUT_MS}ms`);
      proc.kill();
      auditLog({ userId: userId!, action: "timeout", details: `Killed after ${CLAUDE_TIMEOUT_MS}ms` });
    }, CLAUDE_TIMEOUT_MS);

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

    // Wait for process to complete
    const exitCode = await proc.exited;
    console.log("Claude exited with code:", exitCode);

    // Read any stderr
    const stderrReader = proc.stderr.getReader();
    const { value: stderrValue } = await stderrReader.read();
    if (stderrValue) {
      console.error("Claude stderr:", decoder.decode(stderrValue));
    }

    await streaming.finalize();

    if (newSessionId) {
      setSessionId(userId!, newSessionId);
    }

    auditLog({
      userId: userId!,
      action: "response",
      details: `${responseText.length} chars`,
    });

  } catch (err: any) {
    console.error("Claude error:", err);
    await ctx.reply(`Error: ${err.message || "Unknown error"}`);
    auditLog({ userId: userId!, action: "error", details: err.message || "unknown" });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    clearInterval(typingInterval);
    session.isProcessing = false;
    session.currentMessageId = streaming.getMessageId();
    persistSession(userId!, session);
  }
}
