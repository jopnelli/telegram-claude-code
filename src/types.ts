/**
 * TypeScript types for Telegram Claude Code Bot
 */

import type { Context } from "grammy";

// Session data stored per user
export interface UserSession {
  sessionId: string | null;
  isProcessing: boolean;
  abortController: AbortController | null;
  currentMessageId: number | null;
  lastActivity: Date;
  /** Context from a rotated-away session, prepended to the next prompt */
  pendingHandover: string | null;
}

// Persisted session data (saved to disk)
export interface PersistedSession {
  sessionId: string;
  lastActivity: string;
  workingDir: string;
}

// Audit log entry
export interface AuditEntry {
  timestamp: string;
  userId: number;
  username?: string;
  action: string;
  details: string;
}

// Bot context type
export type BotContext = Context;
