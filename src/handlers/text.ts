/**
 * Text message handler - spawns actual Claude Code CLI using Bun subprocess
 */

import type { Context } from "grammy";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { WORKING_DIR } from "../config";

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
  
  if (session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  let responseText = "";
  let currentTool = "";
  let newSessionId: string | null = null;

  try {
    console.log("Spawning claude with args:", args.join(" "));
    
    const proc = Bun.spawn(["claude", ...args], {
      cwd: WORKING_DIR,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

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
    clearInterval(typingInterval);
    session.isProcessing = false;
    session.currentMessageId = streaming.getMessageId();
    persistSession(userId!, session);
  }
}
