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

## Host generations

This repo targets **OpenCode 2.x** and **OpenCode 1.19** from one shared root. The two generations use separate host adapters; never mix them in one adapter. A single flat server entry serves both through the dual default export.

| | v2 | v1 |
|---|---|---|
| Server entry | `persona-injector-server.ts` (dual `{ id, server, setup }`); v2 setup in `persona-injector/server-setup.ts` | same `persona-injector-server.ts`, using `server()` |
| TUI entry | `persona-injector/tui.tsx` | `persona-injector.tsx` |
| Host adapter | `createV2Host(context)` | `createV1Host(api)` |

## Repo layout

| Area | Location | Rules |
|------|----------|-------|
| **dual** server entry | `persona-injector-server.ts` (root) | default export `{ id, server, setup }`: v1 uses `server()`, v2 uses `id` + `setup` (extra `server` stripped) |
| **v2** server setup | `persona-injector/server-setup.ts` | exports `setup(ctx)`; imported by the dual entry; session context hooks only; no TUI/JSX; **type-only** `@opencode/plugin` import (no v2 runtime import, so the v1 loader can evaluate it) |
| **v2** TUI entry | `persona-injector/tui.tsx` | `Plugin.define` from `@opencode/plugin/tui`; slots + `/persona` command |
| **v1** server plugin | `persona-injector-server.ts` (root) | `experimental.chat.system.transform` + `chat.message` (its `server()`) |
| **v1** TUI entry | `persona-injector.tsx` (root) | `tui.json` registration |
| Pure domain | `persona-injector/config.ts`, `personas.ts`, `types.ts`, `agent-detection.ts`, `injection.ts`, `persona-selection.ts`, `dialog-ownership.ts`, `persona-dialog-fit.ts` | pure functions, fully testable, **no host imports** |
| TUI components | `persona-injector/dialog.tsx`, `prompt-indicator.tsx` | presentation only; **host-agnostic — consume only `WlibHost`** |
| Persona packs | `personas/*.json` | shipped defaults (`jungle-mode.json`) + `_template.json` (disabled) |
| Shared code | `persona-injector/wlib/` (submodule) | ALL cross-cutting helpers live here — never duplicate |
| Tests | `tests/persona-injector/*.test.ts` | mirrors the pure modules |

## Runtime paths (process `HOME`)

The plugin resolves its own runtime paths from **`homedir()`**, so they follow the **active process `HOME`** — not a hardcoded v1 root and not the repo checkout:

| Path | Resolves to | Source |
|------|-------------|--------|
| Persona packs | `homedir()/.config/opencode/personas/` | `config.ts` (`PERSONAS_DIR`) |
| Config | `homedir()/.config/opencode/persona-injector.json` (+ legacy `jungle-mode.json`) | `config.ts` |
| System snapshot sidecar | `homedir()/.config/opencode/plugins/persona-injector/system-snapshots.json` | wlib `core/system` (`SYSTEM_SNAPSHOTS_FILE`) |

Consequences:

- **Never hardcode `~` or an absolute `/Users/...` root** in code — always go through `homedir()` so the same module follows whichever `HOME` the host was launched with. Both generations normally share `~/.config/opencode/…`; only an explicitly isolated `HOME` (`$V2_HOME`) moves it.
- Redirecting `HOME` (plus `OPENCODE_CONFIG_DIR` and the XDG roots) to `$V2_HOME` is **optional** and only for separate persona/config **data** — it is **path/config isolation, not an OS sandbox** — code can still reach any absolute path, symlink, or shared mount; the guarantee is only about the *default* root. Discovery does not require it: the dual `persona-injector-server.ts` lets both generations share one normal root.
- Any new homedir-relative file the plugin writes must be added to the `deploy` skill's rsync excludes if it lives inside the live package dir, or it will be deleted on the next `--delete` sync.

## Conventions (MUST)

- **Pure modules** (`config.ts`, `personas.ts`, `types.ts`, `agent-detection.ts`, `injection.ts`, `persona-selection.ts`, `dialog-ownership.ts`, `persona-dialog-fit.ts`) must not import `@opencode/plugin`, `@opencode/plugin/tui`, `@opencode-ai/plugin/tui`, `solid-js`, or a host adapter — that's what makes them testable with `bun:test`.
- **`.ts` vs `.tsx` follows the host transform**: on OpenCode 2.0.27 the local plugin loader applies the Solid runtime transform to **`.tsx`/`.jsx`** only. A **plugin-local** module must therefore be `.tsx` **only when it needs that rewriting** — i.e. it contains **JSX** *or* has a **runtime** import of Solid/OpenTUI that relies on the host transform — because a `.ts` file gets the plain `ts` loader that never runs it. This is **not** a blanket rule that any runtime Solid import requires `.tsx`: a pure `.ts` helper with no such import stays `.ts`, and a **type-only** import (`import type { … } from "solid-js"`) is erased, so it needs no transform either. This is why wlib's `ui/*` are `.tsx` and its `core/*` are `.ts`.
- **Long-lived dialog controllers use wlib's owned-instance; dialog-scoped lifecycle may stay inline**: a v2 dialog's render callback re-runs whenever a signal read directly in its body changes. A **long-lived controller whose factory registers rerender-sensitive state/effects** (`createEffect`, `onCleanup`, a key layer, a timeout — e.g. the `opencode-model-usage` export controller) must be held in `createOwnedInstance`: call the wrapper's **lazy `.get()` inside** the render callback and `dispose()` from the dialog's `onClose`. Constructing such a controller inline replaces it and disposes the old effects on every re-run (the confirmed export-popup bug). This is **not a blanket ban on lifecycle hooks in the render callback**: a component's own dialog-scoped `onMount`/`onCleanup` and its `registerDialogKeyLayer` are valid inline — they are bound to the component and stay host-context-bound — and the persona `dialog.tsx` does exactly this (per-dialog `createDialogOwnership` token, hooks disposed with the component). See `wlib`.
- **Domain before UI**: put logic in `config.ts` / `personas.ts`, then have the entrypoints/components call it. No logic in dialogs or indicators.
- **One host adapter per runtime**: a v2 file builds `createV2Host` and never imports `./wlib/src/host/v1`; a v1 file builds `createV1Host` and never imports `./wlib/src/host/v2`. The shared dialog/indicator only ever see `WlibHost`.
- **Config read precedence** (`readConfig`): new `~/.config/opencode/persona-injector.json` with a persona string → wins outright; explicit `null` persona → disabled (no legacy fallback); parse failure or missing file → legacy `~/.config/opencode/jungle-mode.json` migration (only maps to `"jungle-mode"` when `enabled: true`). Losing this precedence breaks migration.
- **Persona loading** (`loadPersonas`): skips non-JSON/invalid files with a warning, defaults `color` to `#22c55e` at load time, defaults `enabled` to `true` (non-template only), sorts by id (`localeCompare`). See `persona-schema`.
- **No message mutation on the server**: v2 injects solely into `event.system`; v1 records the agent into the `sessionAgent` bridge and injects via `system.transform`.
- **Shared concerns always come from wlib**: scroll, keys, theme, log, reload, clipboard, dialog sizing, system snapshots, host adapters. Creating local copies is a blocker.
- **System snapshot sidecar** (`wlib/system`): the server persists the final system prompt per session so other plugins (e.g. model-usage) can read it — keep writing it in the `finally` of the context hook, skipping title-generator calls.

## Blockers (MUST NOT)

- Importing a host API or SolidJS inside the pure modules
- A **plugin-local** `.ts` module whose **JSX** or **runtime** Solid/OpenTUI import relies on the host transform — the OpenCode 2.0.27 loader rewrites **`.tsx`/`.jsx`** only, so such a module must be `.tsx`. (A **type-only** `import type` from `solid-js` in a `.ts` module is fine — it is erased, and a `.ts` module with no host-rewritten import stays `.ts`.)
- Holding a **long-lived rerender-sensitive controller** (its factory registers `createEffect` / `onCleanup` / a key layer / a timeout — e.g. the `opencode-model-usage` export controller) in a bare local inside a dialog render callback instead of the wlib owned-instance. (A component's own dialog-scoped `onMount`/`onCleanup` and key layer are fine inline — see the convention above.)
- Importing BOTH `host/v1` and `host/v2` in one runtime adapter, or passing a raw plugin API into the shared dialog
- Recreating wlib functionality locally (host adapters/scroll/keys/theme/log/reload/clipboard/dialog/system)
- Putting business logic inside `.tsx` components
- Duplicating pure logic between server and TUI entry — both must call the same `config.ts` / `personas.ts` functions
- Editing persona JSON validation only in the dialog — validation lives in `personas.ts` and is shared

## References
- `plugin-development` — entry points, hooks, dialog flow
- `persona-schema` — persona JSON format and resolution rules
- `testing` — how to verify pure modules
- `wlib` — what the shared library provides (host adapters)
- `quality-check` — gates before reporting done
