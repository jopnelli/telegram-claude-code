/**
 * Photo message handler - spawns Claude CLI with image
 * 
 * Note: Claude CLI doesnt support images directly via -p flag.
 * For now, save image to temp file and tell Claude to look at it.
 * TODO: Implement proper vision support
 */

import type { Context } from "grammy";
import { writeFileSync, unlinkSync } from "fs";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { WORKING_DIR } from "../config";

export async function handlePhoto(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (\!isAuthorized(userId) || \!chatId) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const session = getSession(userId\!);

  if (session.isProcessing) {
    await ctx.reply("Still processing. Use /stop to cancel.");
    return;
  }

  const photos = ctx.message?.photo;
  if (\!photos || photos.length === 0) {
    await ctx.reply("No photo found.");
    return;
  }

  const photo = photos[photos.length - 1];
  const caption = ctx.message?.caption || "What is in this image?";

  auditLog({
    userId: userId\!,
    username: ctx.from?.username,
    action: "photo",
    details: caption.slice(0, 100),
  });

  session.isProcessing = true;
  const streaming = new StreamingState(ctx.api, chatId);

  try {
    // Download image
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();
    
    // Save to temp file
    const tempPath = `/tmp/telegram-photo-${userId}-${Date.now()}.jpg`;
    writeFileSync(tempPath, Buffer.from(buffer));

    // Build prompt that references the image
    const prompt = `I have saved an image to ${tempPath}. Please look at it and answer: ${caption}`;

    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    if (session.sessionId) {
      args.push("--resume", session.sessionId);
    }

    let responseText = "";
    let currentTool = "";
    let newSessionId: string | null = null;

    const proc = Bun.spawn(["claude", ...args], {
      cwd: WORKING_DIR,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let jsonBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      jsonBuffer += decoder.decode(value, { stream: true });
      const lines = jsonBuffer.split("\n");
      jsonBuffer = lines.pop() || "";

      for (const line of lines) {
        if (\!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          
          if (event.session_id && \!newSessionId) {
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
                currentTool = `[${toolName}]\n`;
                await streaming.update(currentTool + responseText);
              }
            }
          }

          if (event.type === "user" && event.tool_use_result) {
            currentTool = "";
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

    // Cleanup temp file
    try { unlinkSync(tempPath); } catch {}

    if (newSessionId) {
      setSessionId(userId\!, newSessionId);
    }

    auditLog({
      userId: userId\!,
      action: "response",
      details: `${responseText.length} chars`,
    });

  } catch (err: any) {
    console.error("Photo error:", err);
    await ctx.reply(`Error: ${err.message}`);
  } finally {
    session.isProcessing = false;
    persistSession(userId\!, session);
  }
}
