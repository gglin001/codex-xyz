# Repository Guidelines

## Project Structure & Module Organization

This repository is a local Codex control-plane prototype with a Next.js client/server app:

- `src/app/`: Next.js App Router entry, route handlers, metadata, and global CSS.
- `src/client/`: client-side dashboard island, browser API wrapper, and interactive UI components.
- `src/server/`: shared API handlers, service layer, SQLite store, event bus, terminal support, and domain types.
- `src/server/codex/`: adapter boundary for real Codex app-server sessions.
- `src/config.ts`: runtime environment parsing.
- `test/`: Vitest coverage for service, API route, and configuration behavior.
- `scripts/`: utility scripts, including Codex protocol generation.
- `third_party/codex/`: upstream Codex reference source and generated protocol context.
- `.next/`: generated Next.js build output.
- `debug_agent/`: untracked scratch workspace for temp files and local experiments (use this instead of `/tmp`).

Runtime state defaults to `.codex-xyz/`.

## Project Notices

Use `NOTICE.md` for repository-specific operating constraints and supported or discouraged patterns. Keep those policy details there instead of duplicating them in this file.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies.
- `pnpm run dev`: start the local Next.js web console with same-origin API routes.
- `pnpm test`: generate Codex types, then run Vitest once.
- `pnpm run typecheck`: run strict TypeScript checks without emitting files.
- `pnpm run build`: generate Codex types, typecheck, and build the client.
- `pnpm run start`: run the built production Next.js server.

## Coding Style & Naming Conventions

- TypeScript is strict ESM; use explicit `.js` extensions for local runtime imports.
- Use two-space indentation, double-quoted strings, and semicolon-free style.
- Keep shared domain contracts in `src/server/domain.ts` or adapter types.
- Prefer small helpers near callers unless a cross-module abstraction already exists.
- React components use PascalCase; functions, variables, and test helpers use camelCase.

## Testing Guidelines

Use Vitest with the Node environment. Add tests under `test/` using `*.test.ts`, grouped with `describe` and `it`.

Prefer test adapters and temporary directories for service or API route behavior. Run `pnpm test` before submitting changes, and run `pnpm run typecheck` when changing shared types, config, adapters, or APIs.

Before starting a dev server for manual validation, use the Next.js app URL (`http://127.0.0.1:1123` by default). If a service already responds there, assume the user has started testing and use that hot-reloading service instead of launching another server.

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
