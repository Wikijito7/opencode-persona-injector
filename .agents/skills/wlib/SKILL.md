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

## Keymap layers & input modes (v2)

- wlib's `registerDialogKeyLayer(host, config)` / `host.keymapLayer(config)` map onto the v2 `context.keymap.layer` API. wlib defaults the layer `mode` to **`"global"`**.
- Why: OpenCode 2.0.27 defaults a layer to `base` and switches the active input mode to `modal` while a dialog is open — a layer left at the host default (`base`) is **inactive exactly when its dialog is visible**. A global plugin/setup layer (e.g. `registerCommand`) has the same problem, so it also uses `mode: "global"`.
- An explicit `config.mode` still wins (caller override preserved). v1 hosts have no mode concept and ignore the field.
- The layer is registered through `context.keymap.layer` and disposed with the reactive computation that created it; the cleanup wlib returns is a no-op on v2.

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
| `core/instance` | pure create-once / dispose-once slot (`createInstanceSlot`); `get()` throws after dispose |
| `ui/owned-instance.tsx` | `createOwnedInstance(factory)` — a value kept in a stable Solid `createRoot` owner that survives dialog render-callback re-runs; for **long-lived, rerender-sensitive controllers** only (component-scoped `onMount`/`onCleanup`/key layers may stay inline). `.tsx`, not `.ts`: its **runtime** `solid-js` import relies on the host transform, which the OpenCode 2.0.27 loader applies to `.tsx`/`.jsx` only |
| `core/export` / `core/export-state` / `core/file` / `core/open-folder` | export contract + pure helpers |
| `ui/export-controller` / `ui/export-overlay` / `ui/export-result-overlay` | export flow + presentational overlays |
| `ui/copied-flash` | `CopiedFlash` reactive footer flash |
| `core/help` | shortcut-table builder |
| `ui/help-overlay` | shortcut help overlay (popup) |

## Stable instances & dialog re-runs (v2)

- A v2 dialog **render callback re-runs** whenever a signal read directly in its body changes. A **long-lived controller whose factory registers rerender-sensitive state/effects** (effects, `onCleanup`, key layers, timeouts — e.g. the `opencode-model-usage` export controller) must not be constructed inline: each re-run replaces it and disposes the *old* instance's effects, so the overlay ends up bound to a fresh, closed object (the confirmed export-popup bug).
- This is **not a blanket prohibition on lifecycle hooks in the render callback**. A component's own dialog-scoped `onMount`/`onCleanup` and its `registerDialogKeyLayer` are bound to the component and stay host-context-bound, so they *may* be built directly inside the callback — the persona `dialog.tsx` does exactly this with a per-dialog `createDialogOwnership` token (disposed on unmount) and no owned-instance. The owned-instance wrapper is for the long-lived, rerender-sensitive controller above.
- For such a **long-lived, rerender-sensitive controller** (and only such a controller), wrap it in `createOwnedInstance` (wlib `ui/owned-instance.tsx`). Construct the wrapper wherever convenient (e.g. before `host.dialog.show`), then call its **lazy `.get()` inside** the render callback so the stable root is created at that call site and inherits the dialog's `Keymap.Provider` context. Later calls return the identical instance; `dispose()` — called from the dialog's `onClose` — tears it down exactly once (idempotent).
- The contract is **lazy** (submodule pin `5cab3e142d910f9931fa6d9253f61ed35a554726`): the factory does **not** run at construction, but on the first `.get()`. `.get()` after `dispose()` throws; a `dispose()` before the first `.get()` never runs the factory.

## Theme resolution (v2)

- `context.theme` is **already resolved**, so its action-state fields drop the `$` sigil: `focused` / `selected` / `base`. The `$focused` / `$selected` spelling appears only in the *raw* theme definitions a plugin might author — never in the resolved context.
- `resolveSemanticTheme` maps the selected chip from `background.action.primary.focused`, then `selected`, then `base` (the selected-row surface), and `selectedText` from `text.action.primary.focused`, then `selected`, then `base`. The default v2 theme leaves `base`/`selected` transparent, so the **focused** token is what actually paints a selected row. Transparent values are treated as absent.

## Import rules (MUST)

- Import directly from the `src/core` / `src/ui` path, e.g. `import { makeScrollState } from "./wlib/src/core/scroll"` — never `export { x } from "./wlib/..."`. The plugin runtime transpiler **drops re-exports** and the names end up undefined.
- Never create a sibling file with the same base name (`.ts` vs `.tsx`) — host resolution may pick the wrong one.
- **`.tsx` is for modules the host must rewrite.** On OpenCode 2.0.27 the local plugin loader applies the Solid runtime transform to **`.tsx`/`.jsx`** only, so a **plugin-local** module must be `.tsx` when it contains **JSX** or a **runtime** Solid/OpenTUI import that relies on that rewrite — a `.ts` file gets the plain `ts` loader that never runs it. This is **not** a blanket rule that every runtime Solid import forces `.tsx`: a **type-only** import (`import type`) is erased, so a `.ts` module using it stays `.ts`, and JSX-free helpers with no host-rewritten import (`core/*`) stay `.ts`.
- For theme colors: values are `ThemeColorValue` (`string | RGBA`) — pass objects through, never string-coerce.
- A v2 module imports only `./wlib/src/host/v2`; a v1 module only `./wlib/src/host/v1`. Never both in one adapter.

## Submodule upkeep

- Bump: `git -C persona-injector/wlib fetch origin && git -C persona-injector/wlib merge origin/v2` at repo root, then commit the pointer change. Do **not** use bare `git submodule update --remote`: `.gitmodules` sets no `branch`, so `--remote` follows the submodule's remote HEAD (`origin/main`) — never the v2 pin. The canonical v2 foundation pin is `opencode-wlib` commit `5cab3e142d910f9931fa6d9253f61ed35a554726` (Restrict export error result to a single Close action).
- If the submodule working tree is dirty and the merge refuses:
  1. **Inspect first:** `git -C persona-injector/wlib status` to see exactly what is modified/untracked.
  2. **Preserve the work — never discard it:** commit it on the submodule branch, or `git -C persona-injector/wlib stash push -u -m wlib-pre-v2`.
  3. **Recover to the parent gitlink:** `git submodule update --init --force persona-injector/wlib` (checks out the commit the parent repo pins).
  4. **Advance only when clean:** `git -C persona-injector/wlib fetch origin && git -C persona-injector/wlib merge --ff-only origin/v2`, then restore any stash with `git -C persona-injector/wlib stash pop`.
  Never run a destructive reset (`git reset --hard origin/main`, `origin/v2`, or bare) — this is a v2 submodule, `main` is not its foundation branch, and a reset discards local work and checks out the wrong lineage.
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
