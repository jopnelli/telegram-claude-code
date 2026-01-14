/**
 * Telegram Claude Code Bot - Entry Point
 *
 * Conversational interface to Claude Code via Telegram.
 */

import { Bot } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { autoRetry } from "@grammyjs/auto-retry";
import { TELEGRAM_TOKEN, ALLOWED_USERS, WORKING_DIR } from "./config";
import {
  handleStart,
  handleNew,
  handleStop,
  handleStatus,
  handleResume,
  handleSend,
  handleText,
  handlePhoto,
} from "./handlers";

// Create bot instance
const bot = new Bot(TELEGRAM_TOKEN);

// Auto-retry on rate limits
bot.api.config.use(autoRetry());

// Sequentialize messages per user to prevent race conditions
// Commands bypass sequentialization for immediate response
bot.use(
  sequentialize((ctx) => {
    // Commands work immediately
    if (ctx.message?.text?.startsWith("/")) {
      return undefined;
    }
    // ! prefix bypasses queue (interrupt)
    if (ctx.message?.text?.startsWith("!")) {
      return undefined;
    }
    // Other messages sequentialized per user
    return ctx.from?.id.toString();
  })
);

// ============== Command Handlers ==============

bot.command("start", handleStart);
bot.command("new", handleNew);
bot.command("stop", handleStop);
bot.command("status", handleStatus);
bot.command("resume", handleResume);
bot.command("send", handleSend);

// ============== Message Handlers ==============

bot.on("message:text", handleText);
bot.on("message:photo", handlePhoto);

// ============== Error Handler ==============

bot.catch((err) => {
  console.error("Bot error:", err);
});

// ============== Startup ==============

console.log("=".repeat(50));
console.log("Telegram Claude Code Bot");
console.log("=".repeat(50));
console.log(`Working directory: ${WORKING_DIR}`);
console.log(`Allowed users: ${ALLOWED_USERS.join(", ")}`);
console.log("Starting bot...");

// Get bot info
const botInfo = await bot.api.getMe();
console.log(`Bot started: @${botInfo.username}`);
console.log("=".repeat(50));

// Start with concurrent runner
const runner = run(bot);

// Graceful shutdown
const stopRunner = () => {
  if (runner.isRunning()) {
    console.log("Stopping bot...");
    runner.stop();
  }
};

process.on("SIGINT", () => {
  console.log("Received SIGINT");
  stopRunner();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Received SIGTERM");
  stopRunner();
  process.exit(0);
});
