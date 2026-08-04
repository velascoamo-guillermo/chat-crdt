#!/usr/bin/env bash
# Start/stop the apps/server NestJS dev process for the Maestro offline-sync E2E flow.
#
# This is the "go offline" / "restore network" technique documented in ticket #13
# amendment 2: no airplane mode (not controllable on the iOS simulator — there's no
# real radio to toggle). Instead we kill the actual server process to sever the
# client's WebSocket, exercising the real client code path (ws close ->
# WebSocketProvider exponential-backoff reconnect loop, SyncEngine keeps buffering
# local Y.Array ops regardless of connection state), then restart it.
#
# Usage:
#   apps/mobile/.maestro/scripts/server-ctl.sh start   # idempotent — no-op if already up
#   apps/mobile/.maestro/scripts/server-ctl.sh stop
#   apps/mobile/.maestro/scripts/server-ctl.sh reset-room  # DELETE FROM "Room" WHERE name='default'
#
# Port 3001 (and the shared infra/docker-compose.yml postgres on 5432) are the
# "default ports" lane owned by this ticket (see amendment 1) — safe to restart here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
PORT=3001
LOGFILE="/tmp/chatcrdt-maestro-server.log"

start() {
  if lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[server-ctl] already listening on :${PORT}"
  else
    echo "[server-ctl] starting apps/server on :${PORT}..."
    (cd "$ROOT_DIR/apps/server" && nohup bun run dev >"$LOGFILE" 2>&1 &)
  fi

  echo "[server-ctl] waiting for :${PORT} to accept HTTP requests..."
  for _ in $(seq 1 40); do
    if curl -s -o /dev/null "http://localhost:${PORT}/auth/login" \
      -X POST -H "Content-Type: application/json" -d '{}'; then
      echo "[server-ctl] server is up"
      return 0
    fi
    sleep 1
  done
  echo "[server-ctl] server did not come up within 40s — check ${LOGFILE}" >&2
  exit 1
}

stop() {
  local pids
  pids="$(lsof -ti ":${PORT}" || true)"
  if [ -n "$pids" ]; then
    kill $pids
    echo "[server-ctl] stopped pids: $pids"
    for _ in $(seq 1 10); do
      if ! lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then break; fi
      sleep 0.5
    done
  else
    echo "[server-ctl] nothing listening on :${PORT}"
  fi
}

reset_room() {
  echo "[server-ctl] resetting 'default' room state for a deterministic run..."
  docker compose -f "$ROOT_DIR/infra/docker-compose.yml" exec -T postgres \
    psql -U chatcrdt -d chatcrdt -c "DELETE FROM \"Room\" WHERE name = 'default';"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  reset-room) reset_room ;;
  *)
    echo "usage: $0 {start|stop|reset-room}" >&2
    exit 1
    ;;
esac
