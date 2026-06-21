# codex-xyz

```bash
export CODEX_XYZ_UI_URL="http://127.0.0.1:1123"
pnpm run dev
# http://127.0.0.1:1123
```

```bash
CODEX_XYZ_DEBUG_LEVEL=1 pnpm run dev
CODEX_XYZ_DEBUG_LEVEL=2 pnpm run dev
CODEX_XYZ_DEBUG_LEVEL=3 pnpm run dev
# custom env
export CODEX_XYZ_UI_URL="http://100.64.0.4:1123"
export CODEX_HOME="${PWD}/dot.home/.codex"
CODEX_XYZ_DEBUG_LEVEL=2 pnpm run dev
# http://100.64.0.4:1123
```
