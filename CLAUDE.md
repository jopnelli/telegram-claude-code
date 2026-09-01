# Telegram Claude Code

Telegram bot that spawns the Claude CLI for each message.

## Architecture

```
Telegram message
    -> grammy bot receives it
    -> Bun.spawn("claude", ["-p", message, "--output-format", "stream-json", "--verbose", "--resume", sessionId])
    -> Parse JSON stream, update Telegram message
    -> Save session ID for next message
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Bot setup, middleware, handlers |
| `src/handlers/text.ts` | Main handler - spawns Claude CLI |
| `src/handlers/commands.ts` | /new, /stop, /status, /resume |
| `src/session.ts` | Session ID persistence |
| `src/rotation.ts` | Middleware, auto-rotates a stale or oversized session |
| `src/streaming.ts` | Throttled Telegram message updates |
| `src/security.ts` | User allowlist, audit logging |
| `src/config.ts` | Environment variables |
| `bin/telegram-send-file.sh` | Installed to `~/bin`, sends files as attachments |

## CLI Integration

Each message runs:
```bash
claude -p "message" --output-format stream-json --verbose --resume <session_id>
```

The `stream-json` output provides events:
- `system` - Session init with session_id
- `assistant` - Text and tool_use blocks
- `user` - Tool results
- `result` - Final response

## Session Management

- Session IDs stored in `<SESSION_DIR>/{userId}.json`, default `../data/sessions`
  relative to the repo root
- `--resume` flag continues conversation
- `/new` clears session for fresh start
- Auto-rotation (`src/rotation.ts`): before a non-command message is handled,
  a session whose transcript passed `MAX_TRANSCRIPT_BYTES` or that sat idle
  longer than `MAX_SESSION_IDLE_MS` is reset through the same `resetSession()`
  as `/new`, with a one-line notice to the user. The transcript is read at
  `~/.claude/projects/<CLAUDE_WORKING_DIR with "/" as "-">/<sessionId>.jsonl`.
  A check that throws is logged and ignored, the message is still handled.
- External handoff: a newer `lastActivity` in the file wins over the in-memory
  session, so another process can hand its session to the bot. `workingDir`
  must match `CLAUDE_WORKING_DIR` or the file is ignored.

## Instances

A second bot is a second `.env` plus a second service, not a fork.
`INSTANCE_PROMPT_FILE` points at a file appended to the system prompt, re-read
per message in `instancePrompt()` (`src/handlers/text.ts`); unset keeps the
built-in Wiedervorlage context in the same file. Per instance also
`TELEGRAM_BOT_TOKEN`, `SESSION_DIR` and `AUDIT_LOG`, all read in `src/config.ts`,
plus `TELEGRAM_BOT_ENV_FILE`, the only one of them handed to the subprocess in
`claudeEnv()` so `/send` answers through this instance's bot.

## Streaming

- Parse JSON lines from Claude stdout
- Show tool calls: `[Bash: ls -la]`
- Update Telegram message every 300ms (throttled)
- Truncate to 4096 chars (Telegram limit)

## Commands

```bash
bun run start      # Production
bun run dev        # Development with watch
```
