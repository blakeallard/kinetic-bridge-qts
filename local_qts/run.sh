#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PORT="${PORT:-8789}"
DB_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

echo "Local QTS → http://127.0.0.1:${PORT}"
echo "Postgres  → ${DB_URL}"
echo "Health    → http://127.0.0.1:${PORT}/api/health"
echo

export DATABASE_URL="$DB_URL"
export PORT
export PYTHONPATH="$ROOT${PYTHONPATH:+:$PYTHONPATH}"

exec python -m uvicorn server.main:app --host 127.0.0.1 --port "$PORT"
