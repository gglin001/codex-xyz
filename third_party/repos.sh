#!/usr/bin/env bash
set -euo pipefail

pushd third_party

git clone org-14957082@github.com:openai/codex.git --single-branch
git clone git@github.com:earendil-works/pi.git --single-branch
git clone git@github.com:n0-computer/iroh.git --single-branch

popd
