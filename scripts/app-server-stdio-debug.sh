#!/usr/bin/env bash
set -euo pipefail

mkdir -p debug_agent
run_dir="$(mktemp -d "debug_agent/app-server-stdio-debug.XXXXXX")"
mkfifo "$run_dir/stdin" "$run_dir/stdout" "$run_dir/stderr"
exec 3<>"$run_dir/stdin" 4<>"$run_dir/stdout" 5<>"$run_dir/stderr"

cleanup() {
  set +e
  exec 3>&- 4>&- 5>&-
  if [[ -n "${server_pid:-}" ]]; then
    kill "$server_pid" 2>/dev/null
    wait "$server_pid" 2>/dev/null
  fi
  rm -rf "$run_dir"
}
trap cleanup EXIT INT TERM

export CODEX_HOME="${PWD}/dot.home/.codex"
codex app-server --stdio <"$run_dir/stdin" >"$run_dir/stdout" 2>"$run_dir/stderr" &
server_pid="$!"

python3 scripts/app-server-stdio-debug.py \
  "$run_dir/stdin" \
  "$run_dir/stdout" \
  "$run_dir/stderr" \
  "hi"
