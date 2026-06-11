# NOTICE

## Supported And Encouraged

- Support real Codex app-server sessions as the runtime path.
- Support yolo mode only for Codex sessions.
- Keep approval policy fixed to `never` and sandbox access fixed to full access at the adapter boundary.
- Keep runtime mode decisions centralized in `src/server/codex/`.
- Use test-only adapters under `test/` for deterministic service and HTTP coverage.
- Keep local runtime state in `.codex-xyz/` or another explicit data directory.

## Do Not Do

- Do not add or restore a mock runtime mode.
- Do not add `CODEX_XYZ_ADAPTER`, `CODEX_XYZ_MOCK_DELAY_MS`, or similar runtime-mode switches.
- Do not add approval UI, approval API routes, or approval projection state.
- Do not add alternate approval, sandbox, or permission modes without an explicit product decision.
- Do not hide mode behavior behind environment defaults or undocumented flags.
- Do not commit local state, secrets, or machine-specific Codex configuration.
