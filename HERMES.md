# Sambungkan Hermes Agent ↔ Agent Mission Control

Setelah ini, setiap kali Hermes pakai tool, mulai/selesai session, atau
spawn subagent, Mission Control di `http://localhost:4826` ikut hidup.

## 1. Nyalakan Mission Control

```fish
cd ~/.config/AutoClaw-oversea-official/accounts/ed89c05fb033fb2f8020ea815bba08171b46d5883dd9e39d64a4b8a627a378bd/projects/Default/agent-mission-control
./mulai.sh
```

## 2. Salin forwarder

```fish
mkdir -p ~/.hermes/agent-hooks
cp hermes/mc-forward.py ~/.hermes/agent-hooks/mc-forward.py
chmod +x ~/.hermes/agent-hooks/mc-forward.py
```

## 3. Aktifkan outbound webhook (cara paling bersih)

Edit `~/.hermes/config.yaml`, cari blok `hooks:` yang masih komentar,
ganti dengan:

```yaml
hooks:
  outbound:
    - name: mission-control
      url: http://localhost:4826/api/event
      events: [post_tool_call, on_session_start, on_session_end, subagent_start, subagent_stop, post_llm_call]
      timeout: 5
```

Tidak perlu secret kalau Mission Control jalan lokal tanpa `MC_TOKEN`.
Kalau kamu set `MC_TOKEN`, tambahkan:

```yaml
      secret_env: MC_TOKEN
```

lalu `hermes hooks list` harus menampilkan `mission-control`.

Restart Hermes / gateway:

```fish
hermes status
# kalau gateway perlu restart:
# tutup dan nyalakan lagi desktop Hermes, atau
hermes pause; and hermes resume
```

## 4. (Opsional) Shell hook untuk file_edit yang lebih akurat

Outbound webhook sudah cukup buat melihat aktivitas. Kalau mau
`file_edit` lebih tajam saat Hermes nulis file, tambahkan juga:

```yaml
hooks:
  post_tool_call:
    - matcher: "write_file|patch|terminal"
      command: "~/.hermes/agent-hooks/mc-forward.py"
      timeout: 5
```

Catatan: kalau kamu pakai kedua cara (outbound + shell), event bisa
dobel. Pilih salah satu dulu — **outbound webhook itu cukup**.

## 5. Tes

```fish
# harus muncul di dashboard
curl "http://localhost:4826/api/event?type=agent_start&agent=refactorer&task=hermes+connected"
curl "http://localhost:4826/api/event?type=bark&agent=refactorer&text=hermes+is+on+the+deck"
```

Lalu jalankan Hermes apa pun yang pakai tool. Di dashboard harus muncul:

- Agent `hermes` (atau nama profile) masuk roster
- `thought` tiap tool call
- `bark` tiap jawaban LLM (dipotong 140 karakter)
- File yang ditulis Hermes menyala di file tree

## 6. Mapping event

| Hermes | Mission Control |
|---|---|
| `on_session_start` | `agent_start` |
| `on_session_end` | `agent_done` |
| `post_tool_call` + write/patch | `file_edit` |
| `post_tool_call` + terminal | `thought` (`$ command`) |
| `pre_llm_call` | `thought` |
| `post_llm_call` | `bark` |
| `subagent_start` | `agent_start` (role = child_role) |
| `subagent_stop` | `agent_done` |

## 7. Kalau Hermes di mesin lain

Ganti URL jadi `http://IP-kamu:4826/api/event`, dan jalankan Mission
Control dengan `HOST=0.0.0.0`. Kalau pakai token, samakan `MC_TOKEN`
di kedua sisi.
