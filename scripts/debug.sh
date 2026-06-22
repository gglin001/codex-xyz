#!/usr/bin/env bash
set -euo pipefail

# http://127.0.0.1:1123
export COZ_UI_URL="http://127.0.0.1:1123"
pnpm run dev

COZ_DEBUG_LEVEL=1 pnpm run dev
COZ_DEBUG_LEVEL=2 pnpm run dev
COZ_DEBUG_LEVEL=3 pnpm run dev

# custom env
# http://100.64.0.4:1123
export COZ_UI_URL="http://100.64.0.1:1123"
# export COZ_UI_URL="http://100.64.0.4:1123"
export CODEX_HOME="${PWD}/dot.home/.codex"
COZ_DEBUG_LEVEL=2 pnpm run dev
