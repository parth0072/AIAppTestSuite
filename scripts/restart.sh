#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS=(8787 5173 5174)

echo "Stopping existing processes on ports: ${PORTS[*]}"
for port in "${PORTS[@]}"; do
  pids="$(lsof -t -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo " - killing port ${port}: ${pids}"
    kill ${pids} 2>/dev/null || true
  fi
done

sleep 1

echo "Starting backend + frontend..."
cd "${ROOT_DIR}"
exec npm run dev:all
