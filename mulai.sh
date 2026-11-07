#!/usr/bin/env bash
# Mulai Agent Mission Control — app ASLI, bukan prototype.
# Pakai: ./mulai.sh [path-repo-kamu]
# Contoh: ./mulai.sh ~/projects/toko-online
set -eu
cd "$(dirname "$0")"
PORT="${MC_PORT:-4826}"
REPO="${1:-}"
ARGS=(--port "$PORT")
if [ -n "$REPO" ]; then
  ARGS+=(--repo "$REPO")
fi
URL="http://localhost:$PORT"
echo "=========================================="
echo " AGENT MISSION CONTROL — LIVE"
echo " Dashboard : $URL"
echo " Repo watch: ${REPO:-<tidak ada, kirim event via curl>}"
echo "=========================================="
# coba buka browser kalau ada
if command -v xdg-open >/dev/null 2>&1; then
  (sleep 1.2 && xdg-open "$URL" >/dev/null 2>&1) &
fi
exec node server.js "${ARGS[@]}"
