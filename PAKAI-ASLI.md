# Pakai Agent Mission Control di project ASLI kamu

Ini bukan demo. Ini alat kerja.

## 1. Nyalakan

```bash
cd agent-mission-control
chmod +x mulai.sh
./mulai.sh /path/ke/project-kamu
```

Dashboard terbuka di `http://localhost:4826`.
Setiap file yang berubah di project kamu langsung menyala (agent `FS WATCH`).

## 2. Kirim 2–4 agent AutoClaw ke project itu

Buka AutoClaw, arahkan ke project kamu. Tempel brief ini ke tiap agent
(ganti `NAMA_AGENT` dan tugasnya):

```
Kamu adalah <REFACTORER | TEST WRITER | DOCS WRITER | REVIEWER>.
Project: /path/ke/project-kamu
Jangan sentuh folder agent-mission-control.

Setiap kali kamu menulis file, jalankan:

curl -s -X POST http://localhost:4826/api/event \
  -H 'content-type: application/json' \
  -d '{"type":"file_edit","agent":"<refactorer|tester|scribe|reviewer>","file":"<path relatif>"}'

Awal misi:
curl ... {"type":"agent_start","agent":"...","task":"..."}

Selesai:
curl ... {"type":"agent_done","agent":"..."}

Punya komentar pendek (maks 140 karakter):
curl ... {"type":"bark","agent":"...","text":"..."}

Jalankan test:
curl ... {"type":"test_run","agent":"tester","status":"ok|fail","text":"..."}

Boleh batch: {"events":[{...},{...}]}
```

Brief lengkap per peran tetap di `MISSION-BRIEFS.md` — ganti `demo-repo`
dengan path project kamu.

## 3. Yang tampil di layar itu kejadian nyata

- File menyala karena agent (atau filesystem) benar-benar menulis
- Konflik muncul karena dua agent benar-benar menyentuh file yang sama
- Test hijau/merah karena test benar-benar dijalankan
- Setiap event tersimpan di `events/run-*.jsonl` — audit trail

## 4. Reset sebelum sesi baru (opsional)

```bash
curl -X POST localhost:4826/api/reset
```

## 5. Yang BUKAN bagian dari app asli

- `原型/V1 Agent Mission Control-原型.html` — hanya pratinjau visual, jangan dipakai kerja
- `cli.js seed` — hanya kalau kamu mau tes visual tanpa agent
- `demo-repo/` — sampel; boleh dihapus kalau sudah tidak perlu

App yang kamu pakai: `server.js` + `public/` + `mulai.sh`.
