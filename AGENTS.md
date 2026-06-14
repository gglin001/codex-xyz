# Repository Guidelines

## Project Structure & Module Organization

This repository is a local Codex control-plane prototype with a React client and Node server:

- `src/client/`: Vite UI, browser API wrapper, and application styles.
- `src/server/`: HTTP server, service layer, SQLite store, event bus, and domain types.
- `src/server/codex/`: adapter boundary for real Codex app-server sessions.
- `src/config.ts`: environment and URL parsing.
- `test/`: Vitest coverage for service, HTTP, and configuration behavior.
- `scripts/`: utility scripts, including Codex protocol generation.
- `third_party/codex/`: upstream Codex reference source and generated protocol context.
- `dist/client/`: generated client build output.
- `debug_agent/`: untracked scratch workspace for temp files and local experiments (use this instead of `/tmp`).

Runtime state defaults to `.codex-xyz/`.

## Project Notices

Use `NOTICE.md` for repository-specific operating constraints and supported or discouraged patterns. Keep those policy details there instead of duplicating them in this file.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies.
- `pnpm run dev`: start the local API and Vite web console.
- `pnpm run dev:api`: watch and restart `src/server/index.ts`.
- `pnpm run dev:web`: start only the Vite client.
- `pnpm test`: generate Codex types, then run Vitest once.
- `pnpm run typecheck`: run strict TypeScript checks without emitting files.
- `pnpm run build`: generate Codex types, typecheck, and build the client.

## Coding Style & Naming Conventions

- TypeScript is strict ESM; use explicit `.js` extensions for local runtime imports.
- Use two-space indentation, double-quoted strings, and semicolon-free style.
- Keep shared domain contracts in `src/server/domain.ts` or adapter types.
- Prefer small helpers near callers unless a cross-module abstraction already exists.
- React components use PascalCase; functions, variables, and test helpers use camelCase.

## Testing Guidelines

Use Vitest with the Node environment. Add tests under `test/` using `*.test.ts`, grouped with `describe` and `it`.

Prefer test adapters and temporary directories for service or HTTP behavior. Run `pnpm test` before submitting changes, and run `pnpm run typecheck` when changing shared types, config, adapters, or APIs.

Before starting a dev server for manual validation, resolve the expected UI/API URLs from environment variables, falling back to the defaults (`http://127.0.0.1:1123` and `http://127.0.0.1:3211`) when unset. If services already respond there, assume the user has started testing and use those hot-reloading services instead of launching another server.

### Browser Manual Validation

Use `tools/agent/browser.mjs` for UI screenshots, quick interaction checks, and scripted browser debugging. Prefer the existing UI service from `CODEX_XYZ_UI_URL`, falling back to `http://127.0.0.1:1123`.

```sh
node tools/agent/browser.mjs screenshot --viewport 390,844 --wait-selector '.sessions-header' --wait-timeout 1000 --output mobile.png
node tools/agent/browser.mjs run --wait-selector '.sessions-header' --click '.sidebar-settings-trigger' --wait-selector '.sidebar-settings-popover' --screenshot settings.png
```

Relative outputs default to `debug_agent/`. Use `node tools/agent/browser.mjs --help` for the current flags.

## Commit & Pull Request Guidelines

- Keep commit subjects short, imperative, and focused.
- Prefer first lines under about 72 characters.
- Pull requests should describe behavior changes, list validation commands, and call out environment changes.
- Include screenshots only for visible UI changes.

## Workspace Hygiene and Configuration

- Do not commit local state, secrets, or generated runtime data.
- Keep `.codex-xyz/`, `dot.home/`, and machine-specific Codex config out of commits.
- Prefer documented environment variables over hard-coded URLs, ports, or binary paths.
- When using `third_party/codex/` as reference material, keep edits scoped to this project unless upstream code is explicitly part of the task.
- When searching under `third_party/`, prefer `rg -u` or `rg -uL` so `.gitignore` rules and symlinks do not hide relevant files.
- Put disposable scripts and outputs in `debug_agent/` instead of broadening ignore rules.
