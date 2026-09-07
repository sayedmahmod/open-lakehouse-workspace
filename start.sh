#!/usr/bin/env bash
# Start the open-lakehouse workspace: FastAPI gateway + Next.js UI.
#
# Prerequisites: the open-lakehouse Docker stack is up (Unity Catalog on 8081,
# Spark Connect on 15002, SeaweedFS on 8333).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_PORT="${API_PORT:-8090}"
UI_PORT="${UI_PORT:-3002}"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${UI_PID:-}" ]] && kill "$UI_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [[ ! -d "$ROOT/backend/.venv" ]]; then
  echo "Creating the backend virtualenv..."
  (cd "$ROOT/backend" && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt)
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "$ROOT/frontend" && npm install)
fi

echo "Starting workspace API on :$API_PORT"
(cd "$ROOT/backend" && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT") &
API_PID=$!

until curl -sf -m 2 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; do
  sleep 1
done
echo "Workspace API ready."

echo "Starting UI on :$UI_PORT"
(cd "$ROOT/frontend" && LAKEHOUSE_API_URL="http://127.0.0.1:$API_PORT" PORT="$UI_PORT" npm run dev) &
UI_PID=$!

echo
echo "  open-lakehouse workspace →  http://localhost:$UI_PORT"
echo
wait
