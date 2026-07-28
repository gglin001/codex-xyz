#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

detect_ip() {
  local addresses=""

  if command -v ip >/dev/null 2>&1; then
    addresses="$(ip -o -4 addr show up scope global 2>/dev/null | awk '{ sub(/\/.*/, "", $4); print $4 }' || true)"
  fi

  if [[ -z "$addresses" ]] && command -v ifconfig >/dev/null 2>&1; then
    addresses="$(ifconfig 2>/dev/null | awk '$1 == "inet" { print $2 }' || true)"
  fi

  awk '
    /^100\.64\./ && !tailscale { tailscale = $0 }
    /^192\.168\./ && !lan { lan = $0 }
    !/^127\./ && !/^169\.254\./ && !fallback { fallback = $0 }
    END { print tailscale ? tailscale : lan ? lan : fallback ? fallback : "127.0.0.1" }
  ' <<< "$addresses"
}

export COZ_UI_IP="${COZ_UI_IP:-$(detect_ip)}"
export COZ_UI_PORT="${COZ_UI_PORT:-11235}"
export COZ_DEBUG_LEVEL="${COZ_DEBUG_LEVEL:-2}"
export CODEX_HOME="${CODEX_HOME:-$REPO_ROOT/dot.home/.codex}"

exec node scripts/run-dev.mjs
