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
| `src/streaming.ts` | Throttled Telegram message updates |
| `src/security.ts` | User allowlist, audit logging |
| `src/config.ts` | Environment variables |

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

- Session IDs stored in `data/sessions/{userId}.json`
- `--resume` flag continues conversation
- `/new` clears session for fresh start

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
