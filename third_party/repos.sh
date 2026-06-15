#!/usr/bin/env bash
set -euo pipefail

pushd third_party

git clone org-14957082@github.com:openai/codex.git --single-branch

popd
