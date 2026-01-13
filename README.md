# Telegram Claude Code Bot

Chat with Claude Code from your phone via Telegram. Multi-turn conversations with session persistence, streaming responses, and full Claude Code capabilities.

## Features

- **Conversational** - Multi-turn chat with session persistence across messages
- **Streaming** - See Claude's progress in real-time (tool calls, thinking, responses)
- **Full Claude Code** - File operations, bash commands, web search, and more
- **Opus 4.5** - Uses Claude's most capable model by default

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### Setup

```bash
# Clone the repo
git clone https://github.com/yourusername/telegram-claude-code.git
cd telegram-claude-code

# Install dependencies
bun install

# Create .env file
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_ALLOWED_USERS=your_telegram_user_id
CLAUDE_WORKING_DIR=/path/to/working/directory
ALLOWED_PATHS=/path/to/dir1,/path/to/dir2,/tmp
```

Get your Telegram user ID from [@userinfobot](https://t.me/userinfobot).

### Run

```bash
# Development (with auto-reload)
bun run dev

# Production
bun run start
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/new` | Start fresh session (clears context) |
| `/stop` | Abort current query |
| `/status` | Check if processing |
| `/resume` | Resume session after bot restart |

**Tip:** Prefix a message with `\!` to interrupt the current query and process immediately.

## Deployment (systemd)

Create a service file at `/etc/systemd/system/telegram-claude-code.service`:

```ini
[Unit]
Description=Telegram Claude Code Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/telegram-claude-code
Environment=PATH=/home/youruser/.bun/bin:/usr/bin:/bin
EnvironmentFile=/path/to/telegram-claude-code/.env
ExecStart=/home/youruser/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable telegram-claude-code
sudo systemctl start telegram-claude-code

# View logs
sudo journalctl -u telegram-claude-code -f
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `TELEGRAM_ALLOWED_USERS` | Yes | Comma-separated Telegram user IDs |
| `CLAUDE_WORKING_DIR` | No | Working directory (default: current) |
| `ALLOWED_PATHS` | No | Paths Claude can access (comma-separated) |
| `AUDIT_LOG` | No | Path to audit log file |

### Security

- **User allowlist** - Only configured Telegram user IDs can use the bot
- **Path restrictions** - Claude can only access configured directories
- **Audit logging** - All interactions logged for review

## Project Structure

```
telegram-claude-code/
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Configuration
│   ├── types.ts          # TypeScript types
│   ├── session.ts        # Session management
│   ├── security.ts       # Auth and path validation
│   ├── streaming.ts      # Telegram message updates
│   └── handlers/
│       ├── commands.ts   # Command handlers
│       ├── text.ts       # Text message handler
│       └── photo.ts      # Image handler
├── data/
│   └── sessions/         # Persisted session data
├── .env                  # Environment variables
├── CLAUDE.md             # Instructions for Claude
└── package.json
```

## How It Works

1. You send a message on Telegram
2. Bot receives it via grammy
3. Message is sent to Claude via the Agent SDK
4. Claude streams responses back
5. Bot updates the Telegram message in real-time
6. Session ID is saved for conversation continuity

## License

MIT
