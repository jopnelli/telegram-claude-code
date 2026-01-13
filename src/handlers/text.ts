/**
 * Text message handler - spawns actual Claude Code CLI
 */

import type { Context } from "grammy";
import { spawn } from "child_process";
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
    auditLog({ userId: userId || 0, action: "unauthorized", details: "text message" });
    return;
  }

  let text = ctx.message?.text || "";

  // Handle ! prefix for interrupt
  if (text.startsWith("!")) {
    const session = getSession(userId!);
    if (session.abortController && session.isProcessing) {
      session.abortController.abort();
      auditLog({ userId: userId!, action: "interrupt", details: "! prefix" });
    }
    text = text.slice(1).trim();
    if (!text) return;
  }

  const session = getSession(userId!);

  // Check if already processing
  if (session.isProcessing) {
    await ctx.reply("Still processing. Use /stop to cancel or ! to interrupt.");
    return;
  }

  auditLog({
    userId: userId!,
    username: ctx.from?.username,
    action: "message",
    details: text.slice(0, 100),
  });

  // Set up for processing
  session.isProcessing = true;
  const streaming = new StreamingState(ctx.api, chatId);
  
  // Build CLI arguments
  const args = [
    "-p", text,
    "--output-format", "stream-json",
    "--verbose",
  ];
  
  // Resume session if we have one
  if (session.sessionId) {
    args.push("--resume", session.sessionId);
  }

  let currentDisplay = "";
  let lastToolUse = "";
  let responseText = "";
  let newSessionId: string | null = null;
  let childProcess: ReturnType<typeof spawn> | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      // Spawn claude CLI
      childProcess = spawn("claude", args, {
        cwd: WORKING_DIR,
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      // Store for abort
      session.abortController = {
        abort: () => {
          if (childProcess) {
            childProcess.kill("SIGTERM");
          }
        },
      } as AbortController;

      let buffer = "";

      childProcess.stdout?.on("data", async (data: Buffer) => {
        buffer += data.toString();
        
        // Process complete JSON lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const event = JSON.parse(line);
            
            // Capture session ID
            if (event.type === "system" && event.session_id) {
              newSessionId = event.session_id;
            }
            
            // Handle different event types
            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text") {
                  responseText = block.text;
                  currentDisplay = responseText;
                  await streaming.update(currentDisplay);
                }
                if (block.type === "tool_use") {
                  const toolName = block.name || "tool";
                  let toolInfo = toolName;
                  
                  // Add details for common tools
                  if (block.input?.file_path) {
                    toolInfo += `: ${block.input.file_path}`;
                  } else if (block.input?.command) {
                    toolInfo += `: ${block.input.command.slice(0, 40)}`;
                  } else if (block.input?.pattern) {
                    toolInfo += `: ${block.input.pattern}`;
                  } else if (block.input?.query) {
                    toolInfo += `: ${block.input.query}`;
                  }
                  
                  lastToolUse = `[${toolInfo}]\n`;
                  currentDisplay = lastToolUse + responseText;
                  await streaming.update(currentDisplay);
                }
              }
            }
            
            // Handle content_block_delta for streaming text
            if (event.type === "content_block_delta" && event.delta?.text) {
              responseText += event.delta.text;
              currentDisplay = lastToolUse + responseText;
              await streaming.update(currentDisplay);
            }
            
            // Handle result
            if (event.type === "result") {
              if (event.result) {
                responseText = event.result;
                currentDisplay = responseText;
                await streaming.update(currentDisplay);
              }
              if (event.session_id) {
                newSessionId = event.session_id;
              }
            }
            
          } catch (e) {
            // Not valid JSON, ignore
          }
        }
      });

      childProcess.stderr?.on("data", (data: Buffer) => {
        console.error("Claude stderr:", data.toString());
      });

      childProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Claude exited with code ${code}`));
        }
      });

      childProcess.on("error", (err) => {
        reject(err);
      });
    });

    // Finalize the message
    await streaming.finalize();

    // Save the session ID
    if (newSessionId) {
      setSessionId(userId!, newSessionId);
    }

    auditLog({
      userId: userId!,
      action: "response",
      details: `${responseText.length} chars`,
    });

  } catch (err: any) {
    if (err.message?.includes("SIGTERM") || err.message?.includes("killed")) {
      await ctx.reply("Stopped.");
      auditLog({ userId: userId!, action: "aborted", details: "" });
    } else {
      console.error("Claude error:", err);
      await ctx.reply(`Error: ${err.message || "Unknown error"}`);
      auditLog({ userId: userId!, action: "error", details: err.message || "unknown" });
    }
  } finally {
    session.isProcessing = false;
    session.abortController = null;
    session.currentMessageId = streaming.getMessageId();
    persistSession(userId!, session);
  }
}
