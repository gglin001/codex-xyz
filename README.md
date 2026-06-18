# codex-xyz

`codex-xyz` is a local Codex control-plane prototype. It provides a Next.js web console, same-origin API route handlers, a SQLite projection store, and an app-server adapter for real Codex sessions.

## Usage

Install dependencies:

```bash
pnpm install
```

Start the local console:

```bash
pnpm run dev
```

Open `http://127.0.0.1:1123`. The web console and `/api/*` routes are served from the same Next.js host by default, and local state defaults to `.codex-xyz/codex-xyz.sqlite`.

Start with app-server protocol logging:

```bash
CODEX_XYZ_DEBUG_LEVEL=1 pnpm run dev
CODEX_XYZ_DEBUG_LEVEL=2 pnpm run dev
CODEX_XYZ_DEBUG_LEVEL=3 pnpm run dev
```

Log records are appended as JSON Lines to `.codex-xyz/debug.jsonl`. Level `1` records process lifecycle, stderr, and malformed input. Level `2` adds app-server protocol messages except high-volume stream deltas. Level `3` includes stream deltas such as `item/agentMessage/delta`.

## Checks

Run tests:

```bash
pnpm test
```

Run TypeScript checks:

```bash
pnpm run typecheck
```

Build the production Next.js app:

```bash
pnpm run build
```

Run the production server after building:

```bash
pnpm run start
```
