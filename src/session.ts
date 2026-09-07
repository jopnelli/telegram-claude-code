/**
 * Session management for Claude Agent SDK
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { SESSION_DIR, WORKING_DIR } from "./config";
import type { UserSession, PersistedSession } from "./types";

// In-memory session store
const sessions = new Map<number, UserSession>();

// Ensure session directory exists
try {
  mkdirSync(SESSION_DIR, { recursive: true });
} catch {}

/**
 * Get or create a session for a user
 */
export function getSession(userId: number): UserSession {
  let session = sessions.get(userId);
  
  if (!session) {
    // Try to load from disk
    const persisted = loadPersistedSession(userId);
    
    session = {
      sessionId: persisted?.sessionId || null,
      isProcessing: false,
      abortController: null,
      currentMessageId: null,
      lastActivity: persisted ? new Date(persisted.lastActivity) : new Date(),
      pendingHandover: null,
    };
    
    sessions.set(userId, session);
  } else if (!session.isProcessing) {
    // External handoff: the Wiedervorlage routine writes a newer session file
    // so replies to its ping land in the session that composed it
    const persisted = loadPersistedSession(userId);
    if (
      persisted &&
      persisted.sessionId !== session.sessionId &&
      new Date(persisted.lastActivity).getTime() > session.lastActivity.getTime()
    ) {
      console.log(`Adopting handed-off session ${persisted.sessionId} for user ${userId}`);
      session.sessionId = persisted.sessionId;
      session.lastActivity = new Date(persisted.lastActivity);
    }
  }

  return session;
}

/**
 * Update session with new session ID
 */
export function setSessionId(userId: number, sessionId: string): void {
  const session = getSession(userId);
  session.sessionId = sessionId;
  session.lastActivity = new Date();
  persistSession(userId, session);
}

/**
 * Clear a user's session (for /new command)
 */
export function clearSession(userId: number): void {
  const session = sessions.get(userId);
  
  if (session?.abortController) {
    session.abortController.abort();
  }
  
  sessions.delete(userId);
  
  // Delete persisted session
  const filePath = join(SESSION_DIR, `${userId}.json`);
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {}
}

/**
 * Persist session to disk
 */
export function persistSession(userId: number, session: UserSession): void {
  if (!session.sessionId) return;
  
  const data: PersistedSession = {
    sessionId: session.sessionId,
    lastActivity: session.lastActivity.toISOString(),
    workingDir: WORKING_DIR,
  };
  
  const filePath = join(SESSION_DIR, `${userId}.json`);
  
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to persist session:", err);
  }
}

/**
 * Load persisted session from disk
 */
export function loadPersistedSession(userId: number): PersistedSession | null {
  const filePath = join(SESSION_DIR, `${userId}.json`);
  
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, "utf-8"));
      
      // Validate working directory matches
      if (data.workingDir !== WORKING_DIR) {
        console.log(`Session working dir mismatch for ${userId}, ignoring`);
        return null;
      }
      
      return data;
    }
  } catch (err) {
    console.error("Failed to load persisted session:", err);
  }
  
  return null;
}

/**
 * Get all persisted sessions (for crash recovery)
 */
export function getAllPersistedSessions(): Map<number, PersistedSession> {
  const result = new Map<number, PersistedSession>();
  
  try {
    const files = readdirSync(SESSION_DIR);
    
    for (const file of files) {
      if (file.endsWith(".json")) {
        const userId = parseInt(file.replace(".json", ""));
        
        if (!isNaN(userId)) {
          const session = loadPersistedSession(userId);
          if (session) {
            result.set(userId, session);
          }
        }
      }
    }
  } catch {}
  
  return result;
}
