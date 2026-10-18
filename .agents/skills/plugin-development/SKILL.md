---
name: plugin-development
description: "CRITICAL: Load when touching entry points, hooks, commands, or dialogs in this repo. Missing this = silent hook failures and broken dialogs. Covers v2 server/TUI wiring, the injection pipeline, and deployment."
---

## When to use me
- When modifying `persona-injector/server-setup.ts` (v2 server setup) or `persona-injector/tui.tsx` (v2 TUI)
- When modifying `persona-injector-server.ts` (dual server entry) / `persona-injector.tsx` (v1 TUI)
- When adding or changing the `/persona` command, key binding, or the selection dialog
- When changing how personas are injected or how the active persona is resolved

## Not intended for
- Pure logic in `config.ts` / `personas.ts` → use `architecture`
- Persona JSON format → use `persona-schema`
- Writing tests → use `testing`
- Deep plugin API mechanics → load the global `opencode-plugin` skill (v1-oriented; prefer the local OpenCode 2.0.27 reference for v2)

---

## Entry points

| File | Role |
|------|------|
| `persona-injector/server-setup.ts` | **v2** server setup: exports `setup(ctx)`; registers `session.hook("context"/"compaction"/"generate")`; imported by the dual entry (not an entrypoint) |
| `persona-injector/tui.tsx` | **v2** TUI: `Plugin.define`; `context.ui.slot`, `registerSlashCommand`, `context.ui.toast` |
| `persona-injector/dialog.tsx` | Persona selection dialog — shared, consumes only `WlibHost` |
| `persona-injector/prompt-indicator.tsx` | Active persona name/color indicator (host-agnostic) |
| `persona-injector-server.ts` | **dual** server entry: default `{ id, server, setup }` — v1 `server()` (`system.transform` + `chat.message`), v2 setup from `server-setup.ts` |
| `persona-injector.tsx` | **v1** TUI entry (`createV1Host` + wlib command) |

## Injection pipeline (v2 — MUST, in order)

`session.hook("context")` (and the `compaction` / `generate` variants) must keep this exact order:

1. `readConfig()` → if no persona id, return (injection disabled).
2. Skip if `isTitleGenerator(event.system)` — although v2 uses a separate `title` hook, keep the guard.
3. **Duplicate guard**: if the joined system already contains the `MARKER` (`"Instructions from: persona-injector"`), return. Never change the marker — the guard and the snapshot sidecar depend on it.
4. Resolve agent: `String(event.agent).toLowerCase()` FIRST (authoritative for primary AND subagent), then `detectPrimaryAgent(event.system)` fallback. If no persona prompt resolves, return.
5. `loadPersonaPrompts(personaId)` (cached `Map<personaId, Map<agent, prompt>>`) → look up `prompts.get(agent)`; if missing, return.
6. Prepend `MARKER + "\n" + prompt + "\n\n---\n\n"` to `event.system[0].text` (preserve the part's other fields); if the array is empty, `push({ type: "text", text: MARKER + "\n" + prompt + "\n\n---" })`. Guard both cases.
7. In `finally` (non-title-gen, sessionID present): `writeSystemSnapshot(sessionID, event.system.map(p => p.text).join("\n"))` — the final system sidecar for other plugins. Never skip this.
8. Errors are caught and logged — **never throw from a hook**.
9. Do **not** register the `title` hook — title generation must not receive a persona.

## Agent detection rules (MUST)

- v2: `event.agent` is the authoritative agent id (primary and subagent) — look it up directly.
- Fallback only: `detectPrimaryAgent` (`persona-injector/agent-detection.ts`) — `"Lead Coordinator Agent"` → `coordinator`; system starts with `"You are opencode"` → `plan`; otherwise `undefined`.
- v1: `chat.message` reads `input.agent` (lowercased) into the `sessionAgent` map; never mutate messages.

## Dialog & TUI rules (MUST)

- Build the host once per runtime: `createV2Host(context)` (v2) / `createV1Host(api)` (v1). **Never mix.** Hand the `WlibHost` to `openPersonaDialog`, `registerSlashCommand`, `DialogShell`.
- Dialog opens via `host.dialog.show(...)` + `registerDialogKeyLayer(host, …)` + `makeScrollState` from wlib — never hand-roll key layers or scroll state.
- **Render callbacks re-run**: the `host.dialog.show(render, onClose)` `render` callback re-runs whenever a signal read directly in its body changes. A **long-lived controller whose factory registers rerender-sensitive state/effects** (`createEffect`, a key layer, a timeout — e.g. the `opencode-model-usage` export controller) must be wrapped in wlib's `createOwnedInstance`: construct the wrapper wherever convenient, call its **lazy `.get()` inside** the callback, and `dispose()` from `onClose` (constructing it inline replaces and disposes it on every re-run — the confirmed export-popup bug). This is **not a blanket ban**: the persona dialog itself constructs its component-scoped `onMount`/`onCleanup` and its `registerDialogKeyLayer` directly inside the render callback — valid inline because they are bound to the component — and stays host-context-bound (per-dialog `createDialogOwnership` token, hooks disposed on unmount). See `wlib`.
- **Keymap mode**: wlib's key-layer adapter defaults `mode: "global"`. On OpenCode 2.0.27 a dialog switches the active input mode to `modal` while the host layer default is `base`, so a layer left at `base` is inactive exactly when the dialog is visible. Never hand-roll a layer or force `base`.
- **Arrow-only selector**: the persona dialog navigates with `↑`/`↓` only (`enter` select, `esc` close). Do **not** re-add `j`/`k` aliases — this applies to both the v1 and v2 entrypoints (they share `dialog.tsx`).
- **`.tsx` for host-rewritten JSX/Solid**: on OpenCode 2.0.27 the local plugin loader applies the Solid runtime transform to **`.tsx`/`.jsx`** only, so a **plugin-local** module must be `.tsx` when it contains **JSX** or a **runtime** Solid/OpenTUI import that relies on that rewrite. This is **not** a blanket rule that every runtime Solid import forces `.tsx`: a **type-only** import (`import type`) is erased, so a `.ts` module using it stays `.ts`. The server entry stays `.ts` — it has no JSX and no host-rewritten runtime import.
- Sizing: pass `desired={{ size: "medium", maxHeight: dialogMaxHeight }}` to `DialogShell`; the shell applies the width tier via `host.dialog.set({ size })` reactively. Do not call `setSize` yourself.
- Colors: `host.theme()` (v2 → `resolveSemanticTheme(context.theme)`; v1 → `resolveThemeColors(api.theme.current)`). Values are `ThemeColorValue` — pass through, never string-coerce.
- Toast: `WlibHost` has no toast; the entrypoint injects a `notify` callback (`context.ui.toast.show({ message })` in v2, `api.ui.toast({ message })` in v1).
- v2 slots: `prompt.footer.status` + `home.footer.status` via `context.ui.slot({ append, render })`.
- Row layout: index 0 is always the **"Disabled"** (null persona) row; `_`-prefixed (template) personas are rendered as `[disabled]` and never selectable.
- Select writes config (`writeConfig({ persona: id })`) then notifies via the `onPersonaChanged` callback — the dialog does not touch global state.

## TUI registration (MUST)

- Command: `registerSlashCommand(host, { name: "persona.select", title: "Select Persona", slashName: "persona", key: "ctrl+shift+m" })`.
- v2 indicators: `context.ui.slot({ append: "prompt.footer.status" | "home.footer.status", render })`.
- v1 indicators: `api.slots.register({ order: 176, slots: { session_prompt_right, home_prompt_right } })`.

## Deployment (verify after changes)

Sync to the live plugins folder using the `deploy` skill — it owns the exact sync commands. **One shared root is the default**: ship the flat dual `persona-injector-server.ts` plus the `persona-injector/` package (TUI + helpers). v2 loads the flat file as its server (`id` + `setup`) and the package's `tui.tsx` as its TUI; v1 loads the flat file's `server()` and `persona-injector.tsx`. `server-setup.ts` is not a `server`/`index` entrypoint, so no second server plugin is admitted.

- **Optional isolated HOME (data separation only)** — not required for discovery. If you want v2 to keep its persona/config **data** separate: capture `ORIG_HOME="${ORIG_HOME:-$HOME}"` before redirecting HOME, then `V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"` — a distinct default, never `$HOME`. `V2_PLUGINS_ROOT="$V2_HOME/.config/opencode/plugins"` is the plugins root; `V2_LIVE="$V2_PLUGINS_ROOT/persona-injector"` is the package destination. Mirror `persona-injector/` → `$V2_LIVE` **and copy the flat dual `persona-injector-server.ts`** to `$V2_PLUGINS_ROOT` (v2's server entry is the flat file, not inside the package). Point the launcher's **config surface** at `$V2_HOME`: export `HOME="$V2_HOME"`, `OPENCODE_CONFIG_DIR="$V2_HOME/.config/opencode"`, and the XDG roots (`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`) each anchored under `$V2_HOME`. None may point at the real `~/.config`, `~/.local`, or `~/.cache`. This is **default path/config isolation, not an OS security sandbox** — the v2 process can still reach the v1 root by absolute path/symlink/mount, it just never derives its defaults from the real `$HOME`. `deploy` holds the isolation guard (rejects an empty-or-`/` `V2_HOME`, one that cannot be physically resolved, and one collapsing onto `ORIG_HOME`).
- **v1 keeps the normal config root** — `V1_LIVE="$HOME/.config/opencode/plugins/"`: place `persona-injector.tsx` + the dual `persona-injector-server.ts` there, ship the shared `persona-injector/` modules, and register `./plugins/persona-injector.tsx` in `tui.json`.
- Restart opencode to load changes (plugins load at startup).
- Keep the deployed copy in sync with the repo — flag drift in the quality-check report.

## References
- `opencode-plugin` (global) — plugin API mechanics (v1-oriented)
- OpenCode 2.0.27 reference (`packages/plugin/src/tui/*`, `packages/core/src/plugin/*`)
- `opencode-dialogs` (global) — dialog UX patterns
- `wlib` — host adapters and shared helpers
- `architecture` — where logic belongs
- `persona-schema` — persona JSON format
