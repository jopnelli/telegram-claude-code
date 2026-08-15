#!/usr/bin/env bash
# Schickt eine Datei ueber den Bot an den ersten User aus TELEGRAM_ALLOWED_USERS.
# Die Claude-Session ruft das Skript auf, statt Dateiinhalte in den Chat zu kippen.
# Usage: telegram-send-file.sh <filepath> [caption]

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: telegram-send-file.sh <filepath> [caption]"
    exit 1
fi

FILEPATH="$1"
CAPTION="${2:-$(basename "$FILEPATH")}"

if [ ! -f "$FILEPATH" ]; then
    echo "[ERROR] File not found: $FILEPATH"
    exit 1
fi

# 50MB ist das Telegram-Limit fuer Bot-Uploads
FILE_SIZE=$(stat -c%s "$FILEPATH" 2>/dev/null || stat -f%z "$FILEPATH" 2>/dev/null)
if [ "$FILE_SIZE" -gt 52428800 ]; then
    echo "[ERROR] File too large (max 50MB)"
    exit 1
fi

# Das Skript liegt in ~/bin, findet das Repo also nicht relativ. Pfad ueberschreibbar.
ENV_FILE="${TELEGRAM_BOT_ENV_FILE:-$HOME/tools/telegram-claude-code/.env}"
if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] Bot env not found: $ENV_FILE (set TELEGRAM_BOT_ENV_FILE)"
    exit 1
fi

BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN "$ENV_FILE" | cut -d= -f2-)
CHAT_ID=$(grep TELEGRAM_ALLOWED_USERS "$ENV_FILE" | cut -d= -f2- | cut -d, -f1)

if [ -z "$BOT_TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "[ERROR] BOT_TOKEN or CHAT_ID not found in $ENV_FILE"
    exit 1
fi

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument" \
    -F chat_id="$CHAT_ID" \
    -F document=@"$FILEPATH" \
    -F caption="$CAPTION" \
    > /dev/null

echo "[OK] File sent: $(basename "$FILEPATH")"
