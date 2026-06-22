# NOTICE

## Supported And Encouraged

- Support real Codex app-server sessions as the runtime path.
- Support yolo mode only for Codex sessions.
- Keep approval policy fixed to `never` and sandbox access fixed to full access at the adapter boundary.
- Keep runtime mode decisions centralized in `src/server/codex/`.
- Keep app-server initialization opted into `capabilities.experimentalApi` because this project intentionally uses experimental app-server fields such as `thread/resume.excludeTurns`.
- Use test-only adapters under `test/` for deterministic service and HTTP coverage.
- Keep local runtime state in `.coz/` or another explicit data directory.

## UI Architecture

- Treat `src/client/designSystem.ts` as the owner of visual tokens, tone mappings, radius choices, and reusable Tailwind recipes.
- Treat `src/client/components/uiPrimitives.tsx` as the owner of shared UI building blocks and interaction patterns.
- Prefer extending shared recipes or primitives before adding repeated Tailwind class strings in feature components.
- Keep feature components focused on data flow, composition, and local layout rather than broad visual policy.
- Use stable, verified Tailwind classes for foundational design values such as radius, color, and shadow.

## UI Visual Style

- Keep the app aligned with the graphite dark style: low-contrast dark canvas, restrained graphite panels, rounded controls, subtle borders, and icon-first tools.
- Avoid returning to the previous slate, blue, purple, or multi-accent look unless there is a specific product decision.
- Prefer quiet outline treatments for transcript and work-surface content over large filled blocks.
- Keep related controls visually integrated within their containing row or surface.
- Avoid redundant transcript metadata and generic instructional copy when the same information can be conveyed by structure or content-derived previews.
- Keep composer behavior compact and tool-like, with input and actions presented as one cohesive control.

## Do Not Do

- Do not add or restore a mock runtime mode.
- Do not add `COZ_ADAPTER`, `COZ_MOCK_DELAY_MS`, or similar runtime-mode switches.
- Do not add approval UI, approval API routes, or approval projection state.
- Do not add alternate approval, sandbox, or permission modes without an explicit product decision.
- Do not hide mode behavior behind environment defaults or undocumented flags.
- Do not remove `excludeTurns` from `thread/resume` or `thread/fork` as a workaround for experimental capability errors; fix the app-server capability negotiation instead.
- Do not commit local state, secrets, or machine-specific Codex configuration.
- Do not make one-off UI style changes in feature components when the same behavior belongs in the design system.
