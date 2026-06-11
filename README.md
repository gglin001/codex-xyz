# codex-xyz

`codex-xyz` is a first-version Codex control plane prototype. It provides a local web console, a Node host agent, a SQLite projection store, a mock Codex adapter for deterministic local testing, and an app-server adapter boundary for real Codex sessions.

## Local Usage

Install dependencies:

```bash
pnpm install
```

Run the local tests:

```bash
pnpm test
```

Start the local mock console:

```bash
pnpm run dev
```

Open `http://127.0.0.1:1123`. The API runs on `http://127.0.0.1:3211` and stores local state in `.codex-xyz/codex-xyz.sqlite`.

To override the local UI or API URLs:

```bash
CODEX_XYZ_UI_URL=http://127.0.0.1:1124 CODEX_XYZ_API_URL=http://127.0.0.1:4211 pnpm run dev
```

Use the real Codex app-server adapter when you want to connect to Codex instead of the deterministic mock:

```bash
CODEX_XYZ_ADAPTER=app-server pnpm run dev
```

## What Is Implemented

- Local PWA-style dashboard for projects, tasks, sessions, transcript items, approvals, goals, steer, interrupt, and fork.
- Node control server with REST APIs and server-sent events.
- SQLite WAL projection tables for hosts, projects, threads, turns, items, events, tasks, approvals, prompt recipes, and eval runs.
- Adapter interface with a deterministic mock adapter and a JSONL stdio app-server adapter.
- Build-time Codex protocol generation through `codex app-server generate-ts --experimental`.
- Local test coverage for service orchestration and HTTP APIs.

## Environment

`CODEX_XYZ_ADAPTER` selects `mock` or `app-server`. Tests use `mock`.

`CODEX_XYZ_DATA_DIR` sets the SQLite data directory. It defaults to `.codex-xyz`.

`CODEX_XYZ_UI_URL` sets the Vite dev server URL and the allowed browser origin for API CORS. It defaults to `http://127.0.0.1:5173`.

`CODEX_XYZ_API_URL` sets the local API server URL and the Vite dev proxy target. It defaults to `http://127.0.0.1:3211`. `PORT` is still supported as a port-only fallback when `CODEX_XYZ_API_URL` is not set.

`VITE_CODEX_XYZ_API_URL` sets the browser-side API base URL. `pnpm run dev` derives it from `CODEX_XYZ_API_URL` automatically. Leave it unset for relative `/api` requests.

`CODEX_XYZ_MOCK_DELAY_MS` controls mock streaming delay. It defaults to `220`.

`CODEX_XYZ_CODEX_BIN` selects the Codex binary used by protocol generation and the real adapter. It defaults to `codex`.

## Current Scope

This is intentionally a local-first MVP. Multi-host tunnels, team auth, encrypted storage, advanced eval automation, and production RBAC are left as later slices. The code keeps their state boundaries visible in the schema so those pieces can be added without replacing the first-version control plane.
