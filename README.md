# Telegram Claude Code

Telegram-Bridge zu Claude Code. Jede eingehende Nachricht wird als headless
`claude`-Session beantwortet: echtes Claude Code mit vollem Tool-Zugriff, nur
eben vom Handy aus. Der Gespraechsfaden bleibt ueber Nachrichten hinweg
bestehen, Antworten streamen live in die Telegram-Nachricht.

Zwei Dinge unterscheiden die Bridge von einem simplen Bot:

- **Reply-Kontext.** Antwortet man per Telegram-Reply auf eine Nachricht, bekommt
  die Session eine Zeile `[Antwort auf Nachricht <id>: "..."]` vorangestellt und
  kann die Antwort damit dem richtigen Vorgang zuordnen.
- **Session-Handoff.** Ein externer Prozess (bei mir die taegliche
  Wiedervorlage-Routine) kann seine Claude-Session an die Bridge uebergeben, so
  dass Antworten auf seine Nachrichten in genau der Session landen, die sie
  verfasst hat.

## Voraussetzungen

- [Bun](https://bun.sh)
- [Claude Code](https://claude.com/claude-code) CLI, installiert und angemeldet
  (die Bridge nutzt den Login des CLI, kein API-Key)
- Ein Bot-Token von [@BotFather](https://t.me/BotFather)

## Setup

Bot bei BotFather anlegen: `/newbot`, Namen und Username vergeben, Token
kopieren. Sinnvoll noch `/setprivacy` auf `Disable`, wenn der Bot in Gruppen
mitlesen soll, sonst reicht der Default. Die eigene User-ID liefert
[@userinfobot](https://t.me/userinfobot).

```bash
git clone https://forgejo.seibert.tools/jpusinelli/telegram-claude-code.git
cd telegram-claude-code
bun install
cp .env.example .env
```

In `.env` mindestens setzen:

```bash
TELEGRAM_BOT_TOKEN=<token vom botfather>
TELEGRAM_ALLOWED_USERS=<deine telegram user id>
CLAUDE_WORKING_DIR=/pfad/zum/arbeitsverzeichnis
```

Starten:

```bash
bun run start
```

Ohne `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` und `CLAUDE_WORKING_DIR`
bricht der Start bewusst ab.

### Dateien verschicken

Damit die Session Dateien als echten Anhang schicken kann statt den Inhalt in
den Chat zu kippen, gehoert das mitgelieferte Skript nach `~/bin`:

```bash
install -m 755 bin/telegram-send-file.sh ~/bin/telegram-send-file.sh
```

Es liest Token und Chat-ID aus `~/tools/telegram-claude-code/.env`. Liegt das
Repo woanders, `TELEGRAM_BOT_ENV_FILE` auf die eigene `.env` setzen; die Bridge
reicht den Pfad an die Session durch.

## Mehrere Instanzen

Eine zweite Bridge ist eine zweite `.env` plus ein zweiter Service, kein Fork.
Was die Instanz sein soll, steht in einer Datei:

```bash
INSTANCE_PROMPT_FILE=/pfad/zum/auftrag.md
```

Der Inhalt haengt sich an den System-Prompt und wird pro Nachricht neu gelesen,
laesst sich also ohne Neustart aendern. Ohne den Wert gilt der eingebaute
Wiedervorlage-Kontext, bestehende Instanzen aendern sich also nicht.

Was pro Instanz auseinandergehen muss, sonst greifen zwei Bots in dieselbe
Ablage:

| Variable | Warum |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | eigener Bot |
| `SESSION_DIR` | sonst adoptiert die eine Instanz den Gespraechsfaden der anderen |
| `AUDIT_LOG` | sonst mischen sich die Protokolle |
| `TELEGRAM_BOT_ENV_FILE` | sonst geht `/send` ueber den falschen Bot raus |

## Betrieb

### systemd (Linux-VM)

`/etc/systemd/system/telegram-claude-code.service`:

```ini
[Unit]
Description=Telegram Claude Code Bot
After=network.target

[Service]
Type=simple
User=DEINUSER
WorkingDirectory=/home/DEINUSER/tools/telegram-claude-code
Environment=PATH=/home/DEINUSER/.bun/bin:/home/DEINUSER/.local/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/home/DEINUSER/tools/telegram-claude-code/.env
ExecStart=/home/DEINUSER/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Der `PATH` muss `bun` und `claude` enthalten, sonst findet der Subprozess das
CLI nicht. Das ist der haeufigste Startfehler.

```bash
sudo systemctl enable --now telegram-claude-code
sudo journalctl -u telegram-claude-code -f
```

### launchd (Mac)

`~/Library/LaunchAgents/tools.telegram-claude-code.plist`, danach
`launchctl load` auf die Datei. `EnvironmentVariables` muss denselben `PATH`
mitbringen, `.env` wird von launchd nicht gelesen, die Variablen also entweder
dort eintragen oder per Wrapper-Skript exportieren.

## Commands

| Command | Wirkung |
|---------|---------|
| `/start` | Begruessung, Kurzuebersicht |
| `/new` | Session verwerfen, frisch anfangen |
| `/stop` | Laufende Anfrage abbrechen |
| `/status` | Laeuft gerade was, welche Session |
| `/resume` | Nach Neustart an die letzte Session andocken |
| `/send <pfad>` | Datei vom Server in den Chat schicken |

Ein `!` als Praefix schiebt sich an der Warteschlange vorbei. Fotos und
Dokumente kann man direkt schicken: Bilder landen in `/tmp` und werden nach der
Antwort geloescht, Dokumente unter `<CLAUDE_WORKING_DIR>/Inbox/`.

## Session-Handoff

Pro User liegt eine Datei unter `<SESSION_DIR>/<user-id>.json`, per Default
`data/sessions/<user-id>.json`:

```json
{
  "sessionId": "<claude-session-id>",
  "lastActivity": "2026-08-14T06:00:00.000Z",
  "workingDir": "/pfad/zum/arbeitsverzeichnis"
}
```

Die Bridge schreibt die Datei nach jeder Antwort. Sie liest sie vor jeder neuen
Nachricht wieder ein und uebernimmt eine fremde `sessionId`, wenn deren
`lastActivity` neuer ist als die der laufenden Session. Genau darueber uebergibt
ein externer Prozess seine Session: Datei mit eigener `sessionId` und aktuellem
Zeitstempel schreiben, und die naechste Telegram-Antwort laeuft in dieser
Session weiter.

`workingDir` ist die Sicherung dabei: stimmt der Wert nicht mit
`CLAUDE_WORKING_DIR` ueberein, wird die Datei ignoriert. Sessions aus einem
anderen Arbeitsverzeichnis werden also nicht versehentlich adoptiert.

## Sicherheitsmodell

Die Bridge gibt einem Telegram-Chat Shell- und Dateizugriff auf dem Host. Das
ist der Punkt der Sache und zugleich das Risiko, entsprechend eng ist der
Zugang:

- **Allowlist.** `TELEGRAM_ALLOWED_USERS` ist die eigentliche Zugangskontrolle.
  Jeder Handler prueft die User-ID zuerst, alles andere bekommt `Unauthorized`.
  Die Liste kurz halten, der Bot-Username ist oeffentlich auffindbar.
- **Blocklist gefaehrlicher Kommandos.** `DISALLOWED_TOOLS` in `src/config.ts`
  geht als `--disallowed-tools` an das CLI und sperrt destruktive Befehle
  (`rm -rf`, `git reset --hard`, `git push --force`, `git clean -f`,
  `git branch -D`, `git stash drop`, `find -delete` und weitere). Muster nach
  [claude-code-safety-net](https://github.com/kenryu42/claude-code-safety-net).
- **Pfadgrenzen.** Der Subprozess laeuft mit `CLAUDE_WORKING_DIR` als cwd, jedes
  weitere Verzeichnis muss in `ALLOWED_PATHS` stehen (`--add-dir`). `/send`
  prueft denselben Rahmen, bevor es eine Datei herausgibt.
- **Timeout.** `CLAUDE_TIMEOUT_MS` (Default 5 Minuten) killt haengende Prozesse.
- **Minimales Environment.** Der Subprozess erbt nur `PATH`, `HOME`, `USER` und
  `SHELL`, damit keine Keys aus der Bot-Umgebung in die Session sickern.
- **Audit-Log.** Jede Nachricht, Antwort und Blockade landet als JSON-Zeile in
  `AUDIT_LOG`. Enthaelt Nachrichteninhalte, gehoert also nicht ins Repo (steht
  in `.gitignore`).

Die Blocklist ist eine Bremse, keine Sandbox: wer Shell-Zugriff hat, kommt an
ihr vorbei. Die Bridge gehoert auf eine Maschine, deren Kompromittierung man
verkraftet, nicht auf den Rechner mit den Produktionszugaengen.

## Wiedervorlage

Der System-Prompt in `src/handlers/text.ts` kennt die Wiedervorlage v3: eine
taegliche Routine pingt Entscheidungen per Telegram, die Antworten laufen als
Reply zurueck und werden ueber `ping.msg_ref` in
`System/wiedervorlage/items.json` dem richtigen Item zugeordnet. Semantik und
harte Regeln stehen im Kit unter `jpusinelli/wiedervorlage`
(`CONTRACT.md`, Abschnitt Antworten).

Wer die Bridge ohne Wiedervorlage betreibt, setzt `INSTANCE_PROMPT_FILE` und ist
den Block los; stehen lassen geht auch, er greift nur, wenn es die Dateien gibt.
Wer sie nutzt, braucht das Kit unter
`~/tools/wiedervorlage` und den Vault unter `~/obsidian`, denn beide Pfade sind
im Prompt als Konvention verdrahtet.

## Wie es funktioniert

```
Telegram-Nachricht
    -> grammY nimmt sie entgegen, sequentialize pro User
    -> Bun.spawn("claude", ["-p", text, "--output-format", "stream-json", ...])
    -> JSON-Stream parsen, Telegram-Nachricht alle 300ms editieren
    -> session_id merken, beim naechsten Mal --resume
```

Schlaegt `--resume` fehl, weil die Session abgelaufen ist, wird die Anfrage
automatisch einmal ohne den Flag wiederholt.

## Lizenz

MIT
