---
name: plugin-development
description: "CRITICAL: Load when touching entry points, hooks, commands, or dialogs in this repo. Missing this = silent hook failures and broken dialogs. Covers server/TUI wiring, the injection pipeline, and deployment."
---

## When to use me
- When modifying `persona-injector-server.ts` (server hooks) or `persona-injector.tsx` (TUI entry)
- When adding or changing the `/persona` command, key binding, or the selection dialog
- When changing how personas are injected or how the active persona is resolved

## Not intended for
- Pure logic in `config.ts` / `personas.ts` → use `architecture`
- Persona JSON format → use `persona-schema`
- Writing tests → use `testing`
- Deep plugin API mechanics → load the global `opencode-plugin` skill

---

## Entry points

| File | Role |
|------|------|
| `persona-injector-server.ts` | Server plugin: `experimental.chat.system.transform` (injection) + `chat.message` (sessionAgent bridge) |
| `persona-injector.tsx` | TUI entry: registers `/persona` (ctrl+shift+m) via `registerSlashCommand` + prompt indicator slots |
| `persona-injector/dialog.tsx` | Persona selection dialog (Disabled row + persona rows, scroll, key layer) |
| `persona-injector/prompt-indicator.tsx` | Active persona name/color shown in `session_prompt_right` + `home_prompt_right` |

## Injection pipeline (MUST, in order)

`experimental.chat.system.transform` must keep this exact order:

1. `readConfig()` → if no persona id, return (injection disabled).
2. Skip if `isTitleGenerator(output.system)` — the tiny "title generator" system must never receive a persona.
3. **Duplicate guard**: if the joined system already contains the `MARKER` (`"Instructions from: persona-injector"`), return. Never change the marker — the guard and the snapshot sidecar depend on it.
4. Resolve agent: `sessionAgent.get(sessionID)` wired by `chat.message` FIRST, then `detectPrimaryAgent(output.system)` fallback (covers the hook-ordering race on the first call). If none, return.
5. `loadPersonaPrompts(personaId)` (cached `Map<personaId, Map<agent, prompt>>`) → look up `prompts.get(agent)`; if missing, return.
6. Prepend `MARKER + "\n" + prompt` to `output.system[0]` — if the array is empty, push instead. Guard both cases.
7. In `finally` (non-title-gen, sessionID present): `writeSystemSnapshot(sessionID, output.system.join("\n"))` — the final system sidecar for other plugins. Never skip this.
8. Errors are caught and logged — **never throw from a hook**.

## Agent detection rules (MUST)

- `detectPrimaryAgent`: system contains `"Lead Coordinator Agent"` → `"coordinator"`; starts with `"You are opencode, an interactive CLI tool"` → `"plan"`; anything else → `undefined` (subagents are NOT detected by content).
- `chat.message` must read `input.agent` (lowercased) — `output.message.agent` is NOT reliably populated for subagents. Store in the `sessionAgent` map; never mutate messages.
- Subagents get personas only through the `sessionAgent` bridge, never through content detection.

## Dialog rules (MUST)

- Open via `api.ui.dialog.replace` + `registerDialogKeyLayer` + `makeScrollState` from wlib — never hand-roll key layers or scroll state.
- Sizing: pass the desired size/height via `useDialogSizing(api, { size, maxHeight })` (or `<DialogShell desired={{ size, maxHeight }}>`); hardcoding a fixed height or `setSize` only sets the width tier — height is the scrollbox `maxHeight`. With `DialogShell`, wire `onSizeChange={(size) => api.ui.dialog.setSize(size)}` so the host dialog width stays in sync reactively.
- Colors: `resolveThemeColors(api.theme.current)` — values are RGBA objects, pass them through (never string-coerce).
- Row layout: index 0 is always the **"Disabled"** (null persona) row; `_`-prefixed (template) personas are rendered as `[disabled]` and never selectable.
- Select writes config (`writeConfig({ persona: id })`) then notifies via the `onPersonaChanged` callback — the dialog does not touch global state.

## TUI registration (MUST)

- Command: `registerSlashCommand(api, { name: "persona.select", title: "Select Persona", slashName: "persona", key: "ctrl+shift+m" })`.
- Indicator slots: `session_prompt_right` + `home_prompt_right` with `order: 176`.

## Deployment (verify after changes)

Sync to the live plugins folder using the `deploy` skill (cp entry points + rsync mirror with exclusions + runtime-artifact preservation). Do NOT use raw `cp -r` — it ships test files and can clobber runtime artifacts.

- `cp` the entry points: `persona-injector.tsx` and `persona-injector-server.ts` → `~/.config/opencode/plugins/`.
- rsync-mirror the source tree: `persona-injector/` → `~/.config/opencode/plugins/persona-injector/` (ships `wlib/`; excludes `*.test.ts`, `.git`, `.agents`, etc.; preserves runtime artifacts).

- Restart opencode to load changes (plugins load at startup).
- Register `./plugins/persona-injector.tsx` in `~/.config/opencode/tui.json`.
- Keep the deployed copy in sync with the repo — flag drift in the quality-check report.

## References
- `opencode-plugin` (global) — plugin API mechanics, hooks, loading order
- `opencode-dialogs` (global) — dialog UX patterns
- `wlib` — shared helpers used by every entry point
- `architecture` — where logic belongs
- `persona-schema` — persona JSON format