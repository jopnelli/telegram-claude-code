/**
 * Document message handler - receive files from user
 *
 * Downloads file to working directory and asks Claude to process it.
 */

import type { Context } from "grammy";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { WORKING_DIR, STYLE_PROMPT, claudeEnv } from "../config";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB Telegram bot download limit

export async function handleDocument(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!isAuthorized(userId) || !chatId) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const session = getSession(userId!);

  if (session.isProcessing) {
    await ctx.reply("Still processing. Use /stop to cancel.");
    return;
  }

  const doc = ctx.message?.document;
  if (!doc) {
    await ctx.reply("No document found.");
    return;
  }

  // Check file size
  if (doc.file_size && doc.file_size > MAX_FILE_SIZE) {
    await ctx.reply(`File too large (max 20MB). Size: ${formatSize(doc.file_size)}`);
    return;
  }

  const fileName = doc.file_name || `file-${Date.now()}`;
  const caption = ctx.message?.caption || `Please read and summarize this file: ${fileName}`;

  auditLog({
    userId: userId!,
    username: ctx.from?.username,
    action: "document",
    details: `${fileName} - ${caption.slice(0, 50)}`,
  });

  session.isProcessing = true;
  const streaming = new StreamingState(ctx.api, chatId);

  // Typing indicator
  const sendTyping = () => ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  await sendTyping();
  const typingInterval = setInterval(sendTyping, 4000);

  try {
    // Download file from Telegram
    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();

    // Save to working directory (user can keep it)
    const inboxDir = join(WORKING_DIR, "Inbox");
    mkdirSync(inboxDir, { recursive: true });
    const savePath = join(inboxDir, fileName);
    writeFileSync(savePath, Buffer.from(buffer));

    // Build prompt
    const prompt = `I saved a file you sent to ${savePath}. ${caption}`;

    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--append-system-prompt", STYLE_PROMPT];
    if (session.sessionId) {
      args.push("--resume", session.sessionId);
    }

    let responseText = "";
    let currentTool = "";
    let newSessionId: string | null = null;

    console.log("Spawning claude for document:", fileName);

    const proc = Bun.spawn(["claude", ...args], {
      cwd: WORKING_DIR,
      env: claudeEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer2 = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer2 += decoder.decode(value, { stream: true });
      const lines = buffer2.split("\n");
      buffer2 = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          if (event.session_id && !newSessionId) {
            newSessionId = event.session_id;
          }

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

                currentTool = detail ? `[${toolName}: ${detail}]\n` : `[${toolName}]\n`;
                await streaming.update(currentTool + responseText);
              }
            }
          }

          if (event.type === "user" && event.tool_use_result) {
            currentTool = "";
            await streaming.update(responseText);
          }

          if (event.type === "result" && event.result) {
            responseText = event.result;
            currentTool = "";
            await streaming.update(responseText);
          }
        } catch {}
      }
    }

    await proc.exited;
    await streaming.finalize();

    if (newSessionId) {
      setSessionId(userId!, newSessionId);
    }

    auditLog({
      userId: userId!,
      action: "response",
      details: `document: ${responseText.length} chars`,
    });

  } catch (err: any) {
    console.error("Document error:", err);
    await ctx.reply(`Error: ${err.message}`);
    auditLog({ userId: userId!, action: "error", details: err.message });
  } finally {
    clearInterval(typingInterval);
    session.isProcessing = false;
    persistSession(userId!, session);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
