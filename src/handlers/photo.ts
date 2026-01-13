/**
 * Photo message handler - image understanding
 */

import type { Context } from "grammy";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { isAuthorized, auditLog } from "../security";
import { getSession, setSessionId, persistSession } from "../session";
import { StreamingState } from "../streaming";
import { CLAUDE_MODEL, WORKING_DIR } from "../config";

/**
 * Handle incoming photo messages
 */
export async function handlePhoto(ctx: Context): Promise<void> {
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

  // Get the largest photo
  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    await ctx.reply("No photo found.");
    return;
  }

  const photo = photos[photos.length - 1]; // Largest resolution
  const caption = ctx.message?.caption || "What is in this image?";

  auditLog({
    userId: userId!,
    username: ctx.from?.username,
    action: "photo",
    details: caption.slice(0, 100),
  });

  try {
    // Get file info from Telegram
    const file = await ctx.api.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    // Download the image
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg";

    // Set up for processing
    session.isProcessing = true;
    session.abortController = new AbortController();

    const streaming = new StreamingState(ctx.api, chatId);
    let fullResponse = "";
    let newSessionId: string | null = null;

    // Build multimodal prompt
    const prompt = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64,
        },
      },
      {
        type: "text",
        text: caption,
      },
    ];

    const options: any = {
      model: CLAUDE_MODEL,
      cwd: WORKING_DIR,
      permissionMode: "bypassPermissions",
    };

    if (session.sessionId) {
      options.resume = session.sessionId;
    }

    // Run query with image
    const queryResponse = query({
      prompt,
      options,
      abortController: session.abortController,
    });

    for await (const message of queryResponse) {
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = message.session_id;
      }

      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            fullResponse += block.text;
            await streaming.update(fullResponse);
          }
        }
      }

      if (message.type === "result" && message.subtype === "success") {
        if (message.result && !fullResponse.includes(message.result)) {
          fullResponse = message.result;
          await streaming.update(fullResponse);
        }
      }
    }

    await streaming.finalize();

    if (newSessionId) {
      setSessionId(userId!, newSessionId);
    }

  } catch (err: any) {
    if (err.name === "AbortError") {
      await ctx.reply("Query stopped.");
    } else {
      console.error("Photo query error:", err);
      await ctx.reply(`Error: ${err.message || "Unknown error"}`);
    }
  } finally {
    session.isProcessing = false;
    session.abortController = null;
    persistSession(userId!, session);
  }
}
