---
name: testing
description: "IMPORTANT: Load when writing or modifying tests in this repo. Missing this = tests that don't follow conventions or don't run. Covers bun:test patterns, aliases, and suite layout."
---

## When to use me
- When writing a new test file or test case
- When modifying behavior in `persona-injector/config.ts`, `personas.ts`, `agent-detection.ts`, or the server entrypoints' pure logic
- When a test needs to touch the filesystem or personas on disk

## Not intended for
- Choosing where code lives → use `architecture`
- Running the gates at the end → use `quality-check`

---

## Running tests

```bash
bun test
```

- Run from the repo root — the suite includes `persona-injector/wlib/` submodule tests.
- All suites must pass before reporting done (`{N} pass, 0 fail`).

## Test file layout

| Code under test | Test location |
|-----------------|---------------|
| `persona-injector/config.ts` | `tests/persona-injector/config.test.ts` |
| `persona-injector/personas.ts` | `tests/persona-injector/personas.test.ts` |
| `persona-injector/persona-dialog-fit.ts` | `tests/persona-injector/persona-dialog-fit.test.ts` |
| `persona-injector/agent-detection.ts` (`detectPrimaryAgent`) | `tests/persona-injector/inject.test.ts` |
| wlib modules | inside `persona-injector/wlib/test/` (own test files) |

## Conventions

- Use `describe` / `it` / `expect` (+ `spyOn`, `afterEach`) from `bun:test`.
- Import via the `@persona-injector/*` alias (e.g. `@persona-injector/personas`), configured in `tests/tsconfig.json`.
- The v1 `persona-injector-server.ts` re-exports `detectPrimaryAgent` from `persona-injector/agent-detection.ts`, so `inject.test.ts` may import either path.
- Test **pure functions only** — `config.ts`, `personas.ts`, `agent-detection.ts`, `persona-dialog-fit.ts` are designed for this (no host imports). If a module can't be tested purely, it belongs in `architecture`'s crosshairs, not in a workaround.
- The v2 entrypoints (`persona-injector/index.ts`, `tui.tsx`) and the shared `dialog.tsx` depend on host packages (`@opencode/plugin`, `@opentui/solid`) that are not resolvable in isolation. Test their **pure helpers** instead; do not import the host packages into `bun:test` suites. A host-shaped fake (a plain object matching `WlibHost`) is the only acceptable way to exercise `dialog.tsx` behavior.
- **Scroll-like UI elements**: fake the element (`scrollBy`, `scrollHeight`, `clientHeight`, `scrollTop`) instead of importing DOM — do not pull `@opentui/solid` into unit tests.
- **Filesystem**: `mkdtempSync(join(tmpdir(), "…"))` + cleanup in `afterEach` (see `personas.test.ts` `createdDirs` pattern) — never write to repo paths.
- **Config tests**: exercise the read precedence — new config wins, explicit `null` persona disables, malformed/missing file falls back to legacy `jungle-mode.json`, legacy `enabled: true` maps to `"jungle-mode"`.
- **Personas tests**: cover default color (`#22c55e`), default `enabled`, `_` template auto-disable, `enabled: false` resolution, invalid-shape skipping, and `trimEnd` trimming.
- **Inject tests**: cover `detectPrimaryAgent` — coordinator marker precedence, `plan` preamble, and undefined for subagent/unknown/empty systems.

## Reporting

```
Tests: {N} passed / {M} failed
```

Failed tests are a BLOCKER — never report done or open a PR with red tests.

## References
- `architecture` — where pure modules live
- `quality-check` — the full gate sequence
