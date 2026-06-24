#!/usr/bin/env bash
set -euo pipefail

# default http://127.0.0.1:1123
# pnpm run dev

# COZ_DEBUG_LEVEL=1 pnpm run dev
# COZ_DEBUG_LEVEL=2 pnpm run dev
# COZ_DEBUG_LEVEL=3 pnpm run dev

# prefer using COZ_UI_IP 100.64.x.y with tailscale, eg: http://100.64.0.1:1123
TAIL_IP=$(ifconfig | sed -E -n 's/^[[:space:]]*inet (100\.64\.[0-9]{1,3}\.[0-9]{1,3}).*/\1/p')
COZ_UI_IP="${COZ_UI_IP:-$TAIL_IP}"
COZ_UI_PORT="${COZ_UI_PORT:-1123}"
export COZ_UI_URL="http://${COZ_UI_IP}:${COZ_UI_PORT}"
export CODEX_HOME="${PWD}/dot.home/.codex"
COZ_DEBUG_LEVEL=2 pnpm run dev
# COZ_DEBUG_LEVEL=2 pnpm run dev 2>&1 | tee debug.log
