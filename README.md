# Telegram Claude Code

Chat with Claude Code from your phone via Telegram. This spawns the actual `claude` CLI, giving you the real Claude Code experience - brief, efficient, and agentic.

## Features

- **Real Claude Code** - Spawns the actual CLI, same behavior as terminal
- **Streaming** - See tool calls and responses in real-time
- **Session persistence** - Conversations continue across messages via `--resume`
- **Multi-turn** - Full agentic loop within each message
- **Photos** - Send images for Claude to analyze
- **Files** - Send documents to Claude (saved to Inbox/)
- **File sending** - Request files from server via `/send`

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/code) CLI installed and authenticated
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Setup

```bash
git clone https://github.com/jopnelli/telegram-claude-code.git
cd telegram-claude-code
bun install
cp .env.example .env
```

Edit `.env`:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_ALLOWED_USERS=your_telegram_user_id
CLAUDE_WORKING_DIR=/path/to/working/directory
```

Get your Telegram user ID from [@userinfobot](https://t.me/userinfobot).

### Run

```bash
bun run start
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/new` | Fresh session |
| `/stop` | Abort query |
| `/status` | Check state |
| `/resume` | Resume after restart |
| `/send <path>` | Send file from server |

Prefix with `!` to interrupt current query.

## How It Works

Each Telegram message spawns:

```bash
claude -p "your message" --output-format stream-json --verbose --resume <session_id>
```

This gives you:
- Real Claude Code behavior and personality
- Full tool access (files, bash, web search, etc.)
- Session continuity via `--resume`
- Streaming output parsed and sent to Telegram

## Security

This bot includes several security measures:

- **User allowlist** - Only authorized Telegram user IDs can interact with the bot
- **Minimal environment** - Subprocess runs with only essential env vars (no API keys leaked)
- **Path restrictions** - Uses `--add-dir` to limit Claude's file access
- **Subprocess timeout** - Kills runaway processes after configurable timeout (default: 5 min)
- **Audit logging** - All actions logged to file for review
- **Random temp files** - Photo temp files use UUIDs to prevent prediction attacks
- **Command safety** - Blocks destructive commands via `--disallowed-tools`

### Safety Mode

Set `SAFETY_MODE` in your `.env` to control command restrictions:

| Mode | Description |
|------|-------------|
| `off` | No restrictions (full Claude Code access) |
| `standard` | **Default.** Blocks destructive commands |
| `paranoid` | Standard + blocks interpreter one-liners |

**Commands blocked in `standard` mode:**
- `rm -rf`, `rm -fr` (recursive forced deletion)
- `git reset --hard`, `git reset --merge`
- `git clean -f`, `git clean -fd`, `git clean -fx`
- `git push --force`, `git push -f` (use `--force-with-lease` instead)
- `git branch -D` (force delete)
- `git stash drop`, `git stash clear`
- `git checkout --` (file restoration)
- `find -delete`

**Additional blocks in `paranoid` mode:**
- `python -c`, `python3 -c`
- `node -e`, `ruby -e`, `perl -e`
- `sh -c`, `bash -c`

Based on patterns from [claude-code-safety-net](https://github.com/kenryu42/claude-code-safety-net).

## Deployment (systemd)

```ini
[Unit]
Description=Telegram Claude Code
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/telegram-claude-code
EnvironmentFile=/path/to/telegram-claude-code/.env
ExecStart=/home/youruser/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable telegram-claude-code
sudo systemctl start telegram-claude-code
sudo journalctl -u telegram-claude-code -f
```

## License

MIT
