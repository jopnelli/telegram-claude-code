/**
 * Text message handler - main Claude interaction with proper streaming
 */

import type { Context } from "grammy";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { CLAUDE_MODEL, WORKING_DIR } from "../config";

// Tool name to emoji mapping
const TOOL_EMOJI: Record<string, string> = {
  Read: "📖",
  Write: "✍️",
  Edit: "✏️",
  Bash: "💻",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🔍",
  TodoWrite: "📝",
  Task: "🤖",
};

/**
 * Handle incoming text messages
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
    await ctx.reply("Still processing previous message. Use /stop to cancel or ! to interrupt.");
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
  session.abortController = new AbortController();

  const streaming = new StreamingState(ctx.api, chatId);
  
  // State for building the display
  let currentTool = "";
  let responseText = "";
  let thinkingText = "";
  let newSessionId: string | null = null;

  // Helper to build the display message
  const buildDisplay = (): string => {
    let display = "";
    
    // Show current tool action
    if (currentTool) {
      display += currentTool + "\n\n";
    }
    
    // Show thinking (truncated)
    if (thinkingText) {
      const truncatedThinking = thinkingText.length > 200 
        ? "..." + thinkingText.slice(-200) 
        : thinkingText;
      display += `🧠 _${truncatedThinking}_\n\n`;
    }
    
    // Show response
    if (responseText) {
      display += responseText;
    }
    
    return display || "Processing...";
  };

  try {
    // Build the query options
    const options: any = {
      model: CLAUDE_MODEL,
      cwd: WORKING_DIR,
      permissionMode: "bypassPermissions",
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch"],
    };

    // Resume existing session if we have one
    if (session.sessionId) {
      options.resume = session.sessionId;
    }

    // Run the query with streaming
    const response = query({
      prompt: text,
      options,
      abortController: session.abortController,
    });

    for await (const message of response) {
      // Capture session ID
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = message.session_id;
      }

      // Handle tool use start
      if (message.type === "tool_use") {
        const toolName = message.name || "Unknown";
        const emoji = TOOL_EMOJI[toolName] || "🔧";
        
        // Build tool description
        let toolDesc = `${emoji} Using ${toolName}`;
        
        // Add relevant details based on tool type
        if (message.input) {
          if (toolName === "Read" && message.input.file_path) {
            toolDesc += `: ${message.input.file_path}`;
          } else if (toolName === "Bash" && message.input.command) {
            const cmd = message.input.command.slice(0, 50);
            toolDesc += `: \`${cmd}${message.input.command.length > 50 ? "..." : ""}\``;
          } else if (toolName === "Glob" && message.input.pattern) {
            toolDesc += `: ${message.input.pattern}`;
          } else if (toolName === "Grep" && message.input.pattern) {
            toolDesc += `: ${message.input.pattern}`;
          } else if (toolName === "WebSearch" && message.input.query) {
            toolDesc += `: "${message.input.query}"`;
          }
        }
        
        currentTool = toolDesc;
        await streaming.update(buildDisplay());
      }

      // Handle tool result (clear the tool indicator)
      if (message.type === "tool_result") {
        currentTool = "";
        await streaming.update(buildDisplay());
      }

      // Handle thinking
      if (message.type === "thinking") {
        thinkingText = message.thinking || "";
        await streaming.update(buildDisplay());
      }

      // Handle assistant messages (text content)
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            responseText += block.text;
            currentTool = ""; // Clear tool when we get text
            thinkingText = ""; // Clear thinking when we get response
            await streaming.update(buildDisplay());
          }
        }
      }

      // Handle final result
      if (message.type === "result" && message.subtype === "success") {
        if (message.result) {
          responseText = message.result;
          currentTool = "";
          thinkingText = "";
          await streaming.update(buildDisplay());
        }
      }
    }

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
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      await ctx.reply("Query stopped.");
      auditLog({ userId: userId!, action: "aborted", details: "" });
    } else {
      console.error("Query error:", err);
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
