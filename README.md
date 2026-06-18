# codex-xyz

`codex-xyz` is a local Codex control-plane prototype. It provides a Next.js web console, local API route handlers, a SQLite projection store, and an app-server adapter for real Codex sessions.

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

Start the API-only host for focused HTTP debugging:

```bash
pnpm run dev:api
```

The API-only host listens on `http://127.0.0.1:3211` unless `CODEX_XYZ_API_URL` or `PORT` is set.

Start with app-server protocol logging:

```bash
pnpm run dev -- -v
pnpm run dev -- -vv
pnpm run dev -- -vvv
```

Log records are appended as JSON Lines to `.codex-xyz/debug.jsonl`. `-v` records process lifecycle, stderr, and malformed input. `-vv` adds app-server protocol messages except high-volume stream deltas. `-vvv` includes stream deltas such as `item/agentMessage/delta`.

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
