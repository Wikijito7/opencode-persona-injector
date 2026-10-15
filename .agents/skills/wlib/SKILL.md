---
name: wlib
description: "CRITICAL: Load when needing shared functionality or touching the wlib submodule. Missing this = duplicated helpers and broken builds. Covers host adapters, what wlib provides, import rules, and submodule upkeep."
---

## When to use me
- When you need scroll, keys, theme, logging, clipboard, reload guards, dialogs, commands, system snapshots, the export contract, or a host adapter
- When importing from `persona-injector/wlib/src/...`
- When bumping the submodule or syncing the deployed copy

## Not intended for
- Where code lives overall → use `architecture`
- Plugin entry points → use `plugin-development`

---

## Host adapters (v1 / v2)

wlib talks to the host through **one** contract — `WlibHost` (`src/host/types.ts`) — instead of the raw plugin API. Each OpenCode generation has its own adapter; a runtime must use exactly one and never mix them.

| Generation | Factory | Import | Status |
|---|---|---|---|
| OpenCode **v2** | `createV2Host(context)` | `./wlib/src/host/v2` | **Supported (production)** |
| OpenCode **v1** | `createV1Host(api)` | `./wlib/src/host/v1` | **Deprecated** — transition only |

`WlibHost` exposes: `kind`, `registerCommand(options)`, `keymapLayer(config)`, `dialog` (`show`/`set`/`clear`), `renderer` (`read`/`subscribe`), `theme()` (semantic palette, RGBA preserved).

Build it once per runtime, then pass it to every helper:

```ts
import { createV2Host } from "./wlib/src/host/v2"
const host = createV2Host(context)
registerSlashCommand(host, { … })
openPersonaDialog(host, notify, …)
```

## What wlib provides (`persona-injector/wlib/src/`)

| Module | Provides |
|--------|----------|
| `core/system` | `writeSystemSnapshot` / `readSystemSnapshot` (final system sidecar, throttled + serialized), `isTitleGenerator`, `estimateTokens` (char/4), `SYSTEM_SNAPSHOTS_FILE` |
| `core/scroll` | `makeScrollState` (up/down/page, overflow tracking, scrollToTop) |
| `core/keys` | `registerDialogKeyLayer(host, config)` — host-agnostic key layer |
| `core/theme` | `resolveSemanticTheme(theme)` (v2) / `resolveThemeColors(theme, fallbacks)` (v1) → normalized RGBA-aware palette |
| `core/log` | `createLog` (debug-gated file logging) |
| `core/reload` | `createLoadGuard` (stale-fetch guard) |
| `core/clipboard` | `writeClipboard` (native candidates + OSC 52), `resolveClipboardCandidates`, `buildOsc52Sequence` |
| `core/command` | `registerSlashCommand(host, opts)` (palette command + optional key binding) |
| `core/dialog-fit` | pure `resolveDialogSize` / `resolveDialogMaxHeight` / `resolveDialogFit` |
| `ui/dialog` | `useDialogSizing(host, desired)`, `DialogShell` (takes `host`, applies responsive sizing via `host.dialog.set`) |
| `core/export` / `core/export-state` / `core/file` / `core/open-folder` | export contract + pure helpers |
| `ui/export-controller` / `ui/export-overlay` / `ui/export-result-overlay` | export flow + presentational overlays |
| `ui/copied-flash` | `CopiedFlash` reactive footer flash |
| `core/help` / `ui/help-overlay` | shortcut-table builder / popup |
| `ui/help-overlay` | shortcut help overlay |

## Import rules (MUST)

- Import directly from the `src/core` / `src/ui` path, e.g. `import { makeScrollState } from "./wlib/src/core/scroll"` — never `export { x } from "./wlib/..."`. The plugin runtime transpiler **drops re-exports** and the names end up undefined.
- Never create a sibling file with the same base name (`.ts` vs `.tsx`) — host resolution may pick the wrong one.
- For theme colors: values are `ThemeColorValue` (`string | RGBA`) — pass objects through, never string-coerce.
- A v2 module imports only `./wlib/src/host/v2`; a v1 module only `./wlib/src/host/v1`. Never both in one adapter.

## Submodule upkeep

- Bump: `git submodule update --remote --merge` at repo root, then commit the pointer change. The canonical v2 foundation is `opencode-wlib` commit `e91baf2877bf19c27f70a1c817f1348ccd3f5353`.
- If the submodule working tree is dirty and the merge refuses: `git -C persona-injector/wlib fetch origin && git -C persona-injector/wlib reset --hard origin/main` (only after confirming no local work).
- Keep the deployed copy in sync via the `deploy` skill — do NOT use raw `cp -r persona-injector/wlib …`; it ships test files and can clobber runtime artifacts.
- wlib source lives in the `opencode-wlib` repo — never edit its files only inside the submodule; upstream changes there first.

## Blockers (MUST NOT)

- Duplicating wlib functionality locally (host adapters/scroll/keys/theme/log/reload/clipboard/dialog/system/export/help/file) — shared code lives in wlib, nowhere else
- Re-export patterns from wlib modules
- Mixing `createV1Host` and `createV2Host` in one runtime adapter
- Committing a submodule bump without the deployed copy in sync

## References
- `architecture` — the no-duplication rule
- `plugin-development` — dialogs and server wiring use these helpers
- `deploy` — syncing `wlib/` (and the rest of `persona-injector/`) to the live folder
- https://github.com/Wikijito7/opencode-wlib — the source repo
- `opencode-wlib/MIGRATION.md` — v1 → v2 API mapping
