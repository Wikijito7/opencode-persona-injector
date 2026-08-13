---
name: architecture
description: "CRITICAL: Load when adding, moving, or refactoring code in this repo. Wrong layering = broken tests and unmaintainable plugin. Defines the module boundaries and conventions."
---

## When to use me
- When creating a new file or module in this repo
- When refactoring or moving code between modules
- When deciding where logic belongs (server vs TUI vs pure modules vs personas)

## Not intended for
- Writing tests → use `testing`
- Plugin entry-point wiring (hooks, commands, dialogs) → use `plugin-development`
- Shared-library decisions → use `wlib`
- Persona JSON shape rules → use `persona-schema`

---

## Repo layout

| Area | Location | Rules |
|------|----------|-------|
| Server plugin | `persona-injector-server.ts` (root) | opencode hooks only; no TUI/JSX |
| TUI entry | `persona-injector.tsx` (root) | registers `/persona` command + prompt indicator slots |
| Pure domain | `persona-injector/config.ts`, `persona-injector/personas.ts`, `persona-injector/types.ts` | pure functions, fully testable |
| TUI components | `persona-injector/dialog.tsx`, `persona-injector/prompt-indicator.tsx` | presentation only; no business logic |
| Persona packs | `personas/*.json` | shipped defaults (`jungle-mode.json`) + `_template.json` (disabled) |
| Shared code | `persona-injector/wlib/` (submodule) | ALL cross-cutting helpers live here — never duplicate |
| Tests | `tests/persona-injector/*.test.ts` | mirrors the pure modules |

## Conventions (MUST)

- **Pure modules** (`config.ts`, `personas.ts`, `types.ts`) must not import `@opencode-ai/plugin/tui`, `solid-js`, or the plugin API — that's what makes them testable with `bun:test`.
- **Domain before UI**: put logic in `config.ts` / `personas.ts`, then have the `.tsx` files call it. No logic in dialogs or indicators.
- **Config read precedence** (`readConfig`): new `~/.config/opencode/persona-injector.json` with a persona string → wins outright; explicit `null` persona → disabled (no legacy fallback); parse failure or missing file → legacy `~/.config/opencode/jungle-mode.json` migration (only maps to `"jungle-mode"` when `enabled: true`). Losing this precedence breaks migration.
- **Persona loading** (`loadPersonas`): skips non-JSON/invalid files with a warning, defaults `color` to `#22c55e` at load time, defaults `enabled` to `true` (non-template only), sorts by id (`localeCompare`). See `persona-schema`.
- **No message mutation on the server**: `chat.message` only records the agent into the `sessionAgent` bridge — injection happens solely via `experimental.chat.system.transform`.
- **Shared concerns always come from wlib**: scroll, keys, theme, log, reload, clipboard, dialog sizing, system snapshots. Creating local copies is a blocker.
- **System snapshot sidecar** (`wlib/system`): the server persists the final system prompt per session so other plugins (e.g. model-usage) can read it — keep writing it in the `finally` of `system.transform`, skipping title-generator calls.

## Blockers (MUST NOT)

- Importing the TUI API or SolidJS inside `config.ts` / `personas.ts` / `types.ts`
- Recreating wlib functionality locally (scroll/keys/theme/log/reload/clipboard/dialog/system)
- Putting business logic inside `.tsx` components
- Duplicating pure logic between server and TUI entry — both must call the same `config.ts` / `personas.ts` functions
- Editing persona JSON validation only in the dialog — validation lives in `personas.ts` and is shared

## References
- `plugin-development` — entry points, hooks, dialog flow
- `persona-schema` — persona JSON format and resolution rules
- `testing` — how to verify pure modules
- `wlib` — what the shared library provides
- `quality-check` — gates before reporting done