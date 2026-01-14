/**
 * Send file handler - /send command
 */

import type { Context } from "grammy";
import { InputFile } from "grammy";
import { existsSync, statSync } from "fs";
import { resolve, basename, isAbsolute } from "path";
import { isAuthorized, isPathAllowed, auditLog } from "../security";
import { WORKING_DIR } from "../config";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB Telegram limit

/**
 * /send <filepath> - Send a file to the user
 */
export async function handleSend(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;

  if (!isAuthorized(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }

  const text = ctx.message?.text || "";
  const filePath = text.split(" ").slice(1).join(" ").trim();

  if (!filePath) {
    await ctx.reply("Usage: /send <filepath>\nExample: /send System/notes.md");
    return;
  }

  // Resolve path (relative to working dir or absolute)
  const fullPath = isAbsolute(filePath)
    ? filePath
    : resolve(WORKING_DIR, filePath);

  // Security: check path is allowed
  if (!isPathAllowed(fullPath)) {
    auditLog({
      userId: userId!,
      action: "send_blocked",
      details: `Path not allowed: ${filePath}`,
    });
    await ctx.reply("Path not allowed.");
    return;
  }

  // Check file exists
  if (!existsSync(fullPath)) {
    await ctx.reply(`File not found: ${filePath}`);
    return;
  }

  // Check file size
  const stats = statSync(fullPath);
  if (!stats.isFile()) {
    await ctx.reply("Not a file. Use a file path, not a directory.");
    return;
  }

  if (stats.size > MAX_FILE_SIZE) {
    await ctx.reply(`File too large (max 50MB). Size: ${formatSize(stats.size)}`);
    return;
  }

  try {
    await ctx.replyWithDocument(new InputFile(fullPath), {
      caption: `${basename(fullPath)} (${formatSize(stats.size)})`,
    });

    auditLog({
      userId: userId!,
      action: "send_file",
      details: filePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    auditLog({
      userId: userId!,
      action: "send_error",
      details: `${filePath}: ${message}`,
    });
    await ctx.reply(`Failed to send file: ${message}`);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
