#!/usr/bin/env bash
set -euo pipefail

# default http://127.0.0.1:1123
# pnpm run dev

# COZ_DEBUG_LEVEL=1 pnpm run dev
# COZ_DEBUG_LEVEL=2 pnpm run dev
# COZ_DEBUG_LEVEL=3 pnpm run dev

# prefer using ip 100.64.x.y with tailscale, eg: http://100.64.0.1:1123
IP=$(ifconfig | sed -E -n 's/^[[:space:]]*inet (100\.64\.[0-9]{1,3}\.[0-9]{1,3}).*/\1/p')
export COZ_UI_URL="http://${IP}:1123"
export CODEX_HOME="${PWD}/dot.home/.codex"
COZ_DEBUG_LEVEL=2 pnpm run dev
# COZ_DEBUG_LEVEL=2 pnpm run dev 2>&1 | tee debug.log
