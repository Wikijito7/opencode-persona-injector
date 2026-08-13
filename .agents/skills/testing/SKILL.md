---
name: testing
description: "IMPORTANT: Load when writing or modifying tests in this repo. Missing this = tests that don't follow conventions or don't run. Covers bun:test patterns, aliases, and suite layout."
---

## When to use me
- When writing a new test file or test case
- When modifying behavior in `persona-injector/config.ts`, `persona-injector/personas.ts`, or `persona-injector-server.ts`
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
| `persona-injector-server.ts` (e.g. `detectPrimaryAgent`) | `tests/persona-injector/inject.test.ts` |
| wlib modules | inside `persona-injector/wlib/` (own test files) |

## Conventions

- Use `describe` / `it` / `expect` (+ `spyOn`, `afterEach`) from `bun:test`.
- Import via the `@persona-injector/*` alias (e.g. `@persona-injector/personas`), configured in `tests/tsconfig.json`.
- Test **pure functions only** — `config.ts` and `personas.ts` are designed for this (no TUI imports). If a module can't be tested purely, it belongs in `architecture`'s crosshairs, not in a workaround.
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