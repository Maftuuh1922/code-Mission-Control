# Sambungkan OpenClaw / Claude Code / AutoClaw ↔ Mission Control

Semua agent yang bisa nge-`curl` atau punya hooks bisa masuk dashboard.

## A. OpenClaw / AutoClaw (yang pakai tool exec)

Agent-nya tinggal lapor sendiri setiap nulis file:

```bash
curl -s "http://localhost:4826/api/event?type=file_edit&agent=openclaw&file=src/app.ts"
curl -s "http://localhost:4826/api/event?type=bark&agent=openclaw&text=found+a+400+line+function"
curl -s "http://localhost:4826/api/event?type=agent_start&agent=openclaw&task=refactor+the+thing"
curl -s "http://localhost:4826/api/event?type=agent_done&agent=openclaw"
```

Tempel kontrak ini di prompt / AGENTS.md agent kamu:

```
Setiap kali kamu menulis file, jalankan:
curl -s "http://localhost:4826/api/event?type=file_edit&agent=openclaw&file=PATH_RELATIF"

Awal misi:
curl -s "http://localhost:4826/api/event?type=agent_start&agent=openclaw&task=DESKRIPSI"

Selesai:
curl -s "http://localhost:4826/api/event?type=agent_done&agent=openclaw"

Punya komentar pendek:
curl -s "http://localhost:4826/api/event?type=bark&agent=openclaw&text=KALIMAT"
```

## B. Claude Code / OpenClaw hooks (settings.json)

Kalau kamu pakai Claude Code atau OpenClaw yang baca `~/.claude/settings.json`
atau `.claude/settings.json` di project:

1. Salin forwarder:

```bash
cp hermes/claude-openclaw-hook.py ~/.hermes/agent-hooks/claude-openclaw-hook.py
chmod +x ~/.hermes/agent-hooks/claude-openclaw-hook.py
```

2. Tambahkan di `~/.claude/settings.json` (atau project `.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [
      { "type": "command", "command": "python3 ~/.hermes/agent-hooks/claude-openclaw-hook.py" }
    ],
    "Stop": [
      { "type": "command", "command": "python3 ~/.hermes/agent-hooks/claude-openclaw-hook.py" }
    ],
    "UserPromptSubmit": [
      { "type": "command", "command": "python3 ~/.hermes/agent-hooks/claude-openclaw-hook.py" }
    ],
    "PreToolUse": [
      { "type": "command", "command": "python3 ~/.hermes/agent-hooks/claude-openclaw-hook.py" }
    ],
    "PostToolUse": [
      { "type": "command", "command": "python3 ~/.hermes/agent-hooks/claude-openclaw-hook.py" }
    ]
  }
}
```

Format yang didukung hook ini:
- Claude Code (`hook_event_name`, `tool_name`, `tool_input.file_path`, `tool_input.command`)
- Hermes (`hook_event_name`, `tool_name`, `tool_input`, `extra`)
- OpenClaw generik (`event`, `toolName`, `toolInput`)

## C. Raw HTTP (siapa saja)

```
POST http://localhost:4826/api/event
```

Terima:
- Mission Control: `{"type":"file_edit","agent":"x","file":"a.js"}`
- Hermes: `{"hook_event_name":"post_tool_call", ...}`
- Claude/OpenClaw: `{"hook_event_name":"PostToolUse", ...}` atau `{"event":"PostToolUse", ...}`

## D. Lihat semua agent di satu layar

Dashboard pakai warna + maskot 3D per `agent` id:

| id | warna |
|---|---|
| `refactorer` | amber |
| `tester` | hijau |
| `scribe` | biru |
| `reviewer` | pink |
| `hermes` / `openclaw` | default (masuk roster tetap tampil) |

Agent id apa pun diterima — makhluk 3D-nya abu-abu netral.
