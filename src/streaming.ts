/**
 * Streaming message updates for Telegram
 */

import type { Api } from "grammy";
import { TELEGRAM_MESSAGE_LIMIT, STREAMING_THROTTLE_MS } from "./config";

/**
 * Manages streaming updates to a single Telegram message
 */
export class StreamingState {
  private messageId: number | null = null;
  private chatId: number;
  private buffer: string = "";
  private lastUpdate: number = 0;
  private api: Api;
  private pendingUpdate: NodeJS.Timeout | null = null;

  constructor(api: Api, chatId: number) {
    this.api = api;
    this.chatId = chatId;
  }

  /**
   * Update the streaming message with new content
   */
  async update(text: string): Promise<void> {
    this.buffer = text;
    const now = Date.now();

    // Throttle updates
    if (now - this.lastUpdate < STREAMING_THROTTLE_MS) {
      // Schedule an update if not already pending
      if (!this.pendingUpdate) {
        this.pendingUpdate = setTimeout(() => {
          this.pendingUpdate = null;
          this.doUpdate();
        }, STREAMING_THROTTLE_MS);
      }
      return;
    }

    await this.doUpdate();
  }

  private async doUpdate(): Promise<void> {
    this.lastUpdate = Date.now();
    const content = this.truncate(this.buffer);

    if (!content) return;

    try {
      if (!this.messageId) {
        // Create initial message
        const msg = await this.api.sendMessage(this.chatId, content);
        this.messageId = msg.message_id;
      } else {
        // Edit existing message
        await this.api.editMessageText(this.chatId, this.messageId, content);
      }
    } catch (err: any) {
      // Ignore "message not modified" errors
      if (!err.message?.includes("message is not modified")) {
        console.error("Failed to update message:", err.message);
      }
    }
  }

  /**
   * Finalize the message with final content
   */
  async finalize(): Promise<void> {
    // Clear any pending update
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    const content = this.truncate(this.buffer);
    if (!content) return;

    try {
      if (!this.messageId) {
        await this.api.sendMessage(this.chatId, content);
      } else {
        await this.api.editMessageText(this.chatId, this.messageId, content);
      }
    } catch (err: any) {
      if (!err.message?.includes("message is not modified")) {
        console.error("Failed to finalize message:", err.message);
      }
    }
  }

  /**
   * Get the current message ID
   */
  getMessageId(): number | null {
    return this.messageId;
  }

  /**
   * Truncate text to fit Telegram's limit
   */
  private truncate(text: string): string {
    if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
      return text;
    }
    // Keep the end (most recent content)
    return "..." + text.slice(-(TELEGRAM_MESSAGE_LIMIT - 3));
  }
}

/**
 * Send a simple message, splitting if needed
 */
export async function sendMessage(
  api: Api,
  chatId: number,
  text: string
): Promise<void> {
  if (text.length <= TELEGRAM_MESSAGE_LIMIT) {
    await api.sendMessage(chatId, text);
    return;
  }

  // Split into chunks
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point
    let breakPoint = TELEGRAM_MESSAGE_LIMIT;
    const newlineIndex = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    if (newlineIndex > TELEGRAM_MESSAGE_LIMIT * 0.5) {
      breakPoint = newlineIndex + 1;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint);
  }

  for (const chunk of chunks) {
    await api.sendMessage(chatId, chunk);
  }
}
