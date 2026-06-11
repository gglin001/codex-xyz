# codex-xyz

`codex-xyz` is a local Codex control-plane prototype. It provides a React web console, a Node API host, a SQLite projection store, and an app-server adapter for real Codex sessions.

## Usage

Install dependencies:

```bash
pnpm install
```

Start the local console:

```bash
pnpm run dev
```

Open `http://127.0.0.1:1123`. The API runs on `http://127.0.0.1:3211`, and local state defaults to `.codex-xyz/codex-xyz.sqlite`.

## Checks

Run tests:

```bash
pnpm test
```

Run TypeScript checks:

```bash
pnpm run typecheck
```
