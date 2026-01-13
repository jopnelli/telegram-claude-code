# Telegram Claude Code Bot

A Telegram bot that provides a conversational interface to Claude Code.

## Architecture

```
Telegram -> grammy bot -> Claude Agent SDK -> Claude Opus 4.5
                |                                   |
         Streaming updates              File ops, bash, web search
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, bot setup, middleware |
| `src/config.ts` | Environment variables, paths, limits |
| `src/session.ts` | Claude session persistence |
| `src/security.ts` | User auth, path validation, audit log |
| `src/streaming.ts` | Throttled Telegram message updates |
| `src/handlers/text.ts` | Main message handler with Claude SDK |
| `src/handlers/commands.ts` | /new, /stop, /status, /resume |
| `src/handlers/photo.ts` | Image message handling |

## Key Concepts

### Session Management
- Sessions are Claude Agent SDK session IDs
- Stored in `data/sessions/{userId}.json`
- Allows conversation continuity across messages
- `/new` clears session, `/resume` restores it

### Streaming
- Uses `StreamingState` class for throttled updates
- Updates Telegram message every 300ms max
- Shows tool usage with emojis (📖 Read, 💻 Bash, etc.)
- Truncates to Telegram's 4096 char limit

### Security
- User allowlist via `TELEGRAM_ALLOWED_USERS`
- Path validation via `ALLOWED_PATHS`
- All interactions logged to audit file

## Dependencies

- `grammy` - Telegram bot framework
- `@grammyjs/runner` - Concurrency with sequentialize
- `@grammyjs/auto-retry` - Rate limit handling
- `@anthropic-ai/claude-agent-sdk` - Claude Code integration

## Commands

```bash
# Development
bun run dev

# Production
bun run start

# Service management
sudo systemctl status telegram-claude-code
sudo journalctl -u telegram-claude-code -f
```

## Conventions

- TypeScript with strict mode
- ES modules (`"type": "module"`)
- Async/await for all I/O
- Error handling with try/catch and audit logging
