---
name: testing
description: "IMPORTANT: Load when writing or modifying tests in this repo. Missing this = tests that don't follow conventions or don't run. Covers bun:test patterns, aliases, and suite layout."
---

## When to use me
- When writing a new test file or test case
- When modifying behavior in `persona-injector/config.ts`, `personas.ts`, `agent-detection.ts`, `injection.ts`, `persona-selection.ts`, `dialog-ownership.ts`, or the server entrypoints' pure logic
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
| `persona-injector/injection.ts` (`injectPersona`) | `tests/persona-injector/injection.test.ts` |
| `persona-injector/persona-selection.ts` (`persistPersonaSelection`) | `tests/persona-injector/persona-selection.test.ts` |
| `persona-injector/dialog-ownership.ts` (`createDialogOwnership`, `persistAndCloseIfOwned`, `closeIfOwned`) | `tests/persona-injector/dialog-ownership.test.ts` |
| `persona-injector/persona-dialog-fit.ts` | `tests/persona-injector/persona-dialog-fit.test.ts` |
| `persona-injector/agent-detection.ts` (`detectPrimaryAgent`) | `tests/persona-injector/agent-detection.test.ts` (module + the server re-export); `tests/persona-injector/inject.test.ts` (via `persona-injector-server`) |
| `persona-injector-server.ts` (v1 `server()` hook guarantees on the dual export) | `tests/persona-injector/v1-server-hook.test.ts` |
| wlib modules | inside `persona-injector/wlib/test/` (own test files) |

## Conventions

- Use `describe` / `it` / `expect` (+ `spyOn`, `afterEach`) from `bun:test`.
- Import via the `@persona-injector/*` alias (e.g. `@persona-injector/personas`), configured in `tests/tsconfig.json`.
- The v1 `persona-injector-server.ts` re-exports `detectPrimaryAgent` from `persona-injector/agent-detection.ts`, so `inject.test.ts` may import either path.
- Test **pure functions only** — `config.ts`, `personas.ts`, `agent-detection.ts`, `injection.ts`, `persona-selection.ts`, `dialog-ownership.ts`, `persona-dialog-fit.ts` are designed for this (no host imports). If a module can't be tested purely, it belongs in `architecture`'s crosshairs, not in a workaround.
- Central to this repo, OpenCode 2.0.27 applies its Solid runtime transform **only to `.tsx`/`.jsx`**, so a **plugin-local** module must be `.tsx` when it contains **JSX** or a **runtime** Solid/OpenTUI import that relies on that rewrite — not every runtime Solid import forces `.tsx`. A **type-only** Solid import is erased, so a `.ts` module using it stays `.ts`. That split is also what keeps the pure modules importable in a `bun:test` suite without the host's Solid transform.
- The v2 TUI entrypoint `persona-injector/tui.tsx` and the shared `dialog.tsx` depend on host packages (`@opencode/plugin/tui`, `@opentui/solid`) that are not resolvable in isolation. Test their **pure helpers** instead; do not import the host packages into `bun:test` suites. A host-shaped fake (a plain object matching `WlibHost`) is the only acceptable way to exercise `dialog.tsx` behavior. The dual server entry `persona-injector-server.ts` imports only a **type-only** host `Context` (erased) and stays resolvable, which is why its tests import it directly; the v2 setup helper `persona-injector/server-setup.ts` likewise notes a type-only host import.
- **Scroll-like UI elements**: fake the element (`scrollBy`, `scrollHeight`, `clientHeight`, `scrollTop`) instead of importing DOM — do not pull `@opentui/solid` into unit tests.
- **Filesystem**: `mkdtempSync(join(tmpdir(), "…"))` + cleanup in `afterEach` (see `personas.test.ts` `createdDirs` pattern) — never write to repo paths.
- **Config tests**: exercise the read precedence — new config wins, explicit `null` persona disables, malformed/missing file falls back to legacy `jungle-mode.json`, legacy `enabled: true` maps to `"jungle-mode"`.
- **Personas tests**: cover default color (`#22c55e`), default `enabled`, `_` template auto-disable, `enabled: false` resolution, invalid-shape skipping, and `trimEnd` trimming.
- **Inject tests**: cover `detectPrimaryAgent` — coordinator marker precedence, `plan` preamble, and undefined for subagent/unknown/empty systems.
- **Injection tests**: cover the fail-closed title-generator guard — only boolean `false` continues; `true`, a thrown predicate, and a non-boolean result all abort injection AND snapshot without rejecting the hook — plus the marker duplicate guard, agent routing, and snapshot persistence/skip behavior.
- **Persona-selection tests**: cover `persistPersonaSelection` — success calls `write` then `onPersonaChanged` + success notify and resolves `true`; a rejected `write` sets the inline error, emits the failure notify, resolves `false`, and never calls `onPersonaChanged` (so the dialog stays open for retry). Also cover `createPersonaSelectionPersister` — a second call while the first write is still pending resolves `false` without a second `write`, `notify`, or `onPersonaChanged`.
- **Dialog-ownership tests**: cover `createDialogOwnership` generational invalidation — `activate()`/`invalidate()` bump `generation()` so a stale async completion cannot act on a newer epoch, even though `isActive()` reads `true` again. Cover `persistAndCloseIfOwned` / `closeIfOwned` — a stale owner neither writes nor closes, and only the current epoch closes.

## Reporting

```
Tests: {N} passed / {M} failed
```

Failed tests are a BLOCKER — never report done or open a PR with red tests.

## References
- `architecture` — where pure modules live
- `quality-check` — the full gate sequence
