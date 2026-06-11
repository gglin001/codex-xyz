# Repository Guidelines

## Project Structure & Module Organization

This is a local Codex control-plane prototype with a React client and Node server. `src/client` contains the Vite UI, styles, and browser API wrapper. `src/server` contains the HTTP server, service layer, SQLite store, event bus, and domain types. `src/server/codex` is the adapter boundary for real Codex sessions. Environment parsing lives in `src/config.ts`.

Tests are in `test`; utility scripts live in `scripts`. `third_party/codex` contains upstream Codex source for protocol, runtime, or adapter reference when needed. Protocol types are produced by `scripts/generate-codex-types.mjs`. Build output goes to `dist/client`; runtime state defaults to `.codex-xyz`.

## Build, Test, and Development Commands

- `pnpm install`: install project dependencies. Use Node `>=24.0.0` and pnpm `11.0.3`.
- `pnpm run dev`: start the local API and Vite web console. Open `http://127.0.0.1:1123`.
- `pnpm run dev:api`: watch and restart `src/server/index.ts` only.
- `pnpm run dev:web`: start only the Vite client.
- `pnpm test`: generate Codex types, then run Vitest once.
- `pnpm run typecheck`: run strict TypeScript checks without emitting files.
- `pnpm run build`: generate Codex types, typecheck, and build the client.

## Coding Style & Naming Conventions

Use strict TypeScript with ESM imports and explicit `.js` extensions for local runtime imports. Follow the existing two-space indentation, double-quoted strings, and semicolon-free style. Prefer small pure helpers near callers and keep cross-module contracts in `src/server/domain.ts` or adapter types. React components use PascalCase; functions, variables, and test helpers use camelCase.

## Testing Guidelines

Use Vitest with Node environment. Add tests under `test` using `*.test.ts`, grouped with `describe` and `it`. Prefer test adapters and temporary directories for service or HTTP behavior. Run `pnpm test` before opening a PR, and run `pnpm run typecheck` when changing shared types, config, adapters, or APIs.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries, for example `Handle missing Codex runtime threads` or `default env`. Keep the first line focused and under about 72 characters. Pull requests should describe the behavior change, list validation commands run, and note environment changes such as new `CODEX_XYZ_*` variables. Include screenshots only for visible UI changes.

## Security & Configuration Tips

Do not commit local state, secrets, or generated runtime data. Keep `.codex-xyz`, `dot.home`, and machine-specific Codex configuration out of commits. Prefer documented environment variables from `README.md` over hard-coded URLs, ports, or binary paths.
