---
name: plugin-development
description: "CRITICAL: Load when touching entry points, hooks, commands, or dialogs in this repo. Missing this = silent hook failures and broken dialogs. Covers v2 server/TUI wiring, the injection pipeline, and deployment."
---

## When to use me
- When modifying `persona-injector/index.ts` (v2 server) or `persona-injector/tui.tsx` (v2 TUI)
- When modifying the deprecated `persona-injector-server.ts` / `persona-injector.tsx` (v1)
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
| `persona-injector/index.ts` | **v2** server: `Plugin.define({id, setup})`; registers `session.hook("context"/"compaction"/"generate")` |
| `persona-injector/tui.tsx` | **v2** TUI: `Plugin.define`; `context.ui.slot`, `registerSlashCommand`, `context.ui.toast` |
| `persona-injector/dialog.tsx` | Persona selection dialog — shared, consumes only `WlibHost` |
| `persona-injector/prompt-indicator.tsx` | Active persona name/color indicator (host-agnostic) |
| `persona-injector-server.ts` | **DEPRECATED v1** server (`system.transform` + `chat.message`) |
| `persona-injector.tsx` | **DEPRECATED v1** TUI entry (`createV1Host` + wlib command) |

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

Sync to the live plugins folder using the `deploy` skill. Since v2 auto-discovers plugin **directories**, ship only the `persona-injector/` package for v2; never leave the deprecated v1 `.ts`/`.tsx` files in `plugins/` (v2 server discovery loads bare `.ts` files).

- v2: mirror `persona-injector/` → `~/.config/opencode/plugins/persona-injector/` (ships `wlib/`; excludes tests, `.git`, `.agents`; preserves runtime artifacts). Optionally declare `./plugins/persona-injector` in `~/.config/opencode/cli.json` `plugins`.
- v1: `cp` `persona-injector.tsx` + `persona-injector-server.ts` → `~/.config/opencode/plugins/`, mirror `persona-injector/`, register `./plugins/persona-injector.tsx` in `tui.json`.
- Restart opencode to load changes (plugins load at startup).
- Keep the deployed copy in sync with the repo — flag drift in the quality-check report.

## References
- `opencode-plugin` (global) — plugin API mechanics (v1-oriented)
- OpenCode 2.0.27 reference (`packages/plugin/src/tui/*`, `packages/core/src/plugin/*`)
- `opencode-dialogs` (global) — dialog UX patterns
- `wlib` — host adapters and shared helpers
- `architecture` — where logic belongs
- `persona-schema` — persona JSON format
