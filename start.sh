#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo "=================================================="
echo "  Agent Company OS — One-Command Launcher"
echo "=================================================="

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 24+ is required. Download from https://nodejs.org"
  exit 1
fi

if [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ]; then
  echo "-> Installing dependencies (first run only)..."
  npm run install:all
fi

if [ ! -d "server/dist" ] || [ ! -d "client/dist" ]; then
  echo "-> Building Agent Company OS..."
  npm run build
fi

echo ""
echo "-> Starting Agent Company OS at http://localhost:3001"
echo "   Tip: Click 'Connect AI' in the top bar to link Claude, Gemini & GitHub."
echo ""
exec npm start
