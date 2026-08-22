---
name: wlib
description: "CRITICAL: Load when needing shared functionality or touching the wlib submodule. Missing this = duplicated helpers and broken builds. Covers what wlib provides, import rules, and submodule upkeep."
---

## When to use me
- When you need scroll, keys, theme, logging, clipboard, reload guards, dialogs, commands, system snapshots, or the export contract
- When importing from `persona-injector/wlib/`
- When bumping the submodule or syncing the deployed copy

## Not intended for
- Where code lives overall → use `architecture`
- Plugin entry points → use `plugin-development`

---

## What wlib provides (`persona-injector/wlib/`)

| Module | Provides |
|--------|----------|
| `system` | `writeSystemSnapshot` / `readSystemSnapshot` (final system sidecar, throttled + serialized), `isTitleGenerator`, `estimateTokens` (char/4), `SYSTEM_SNAPSHOTS_FILE` |
| `scroll` | `makeScrollState` (up/down/page, overflow tracking, scrollToTop) |
| `keys` | `registerDialogKeyLayer` (`KeyLayerConfig` incl. optional `priority?: number`, forwarded to `api.keymap.registerLayer`) |
| `theme` | `resolveThemeColors` — normalized RGBA-aware palette incl. `background` / `panel` keys |
| `log` | `createLog` (debug-gated file logging) |
| `reload` | `createLoadGuard` (stale-fetch guard) |
| `clipboard` | `writeClipboard` (native candidates + OSC 52), `resolveClipboardCandidates`, `buildOsc52Sequence` |
| `command` | `registerSlashCommand` (palette command + optional key binding) |
| `dialog` | `useDialogSizing`, `DialogShell` (entry is `dialog.tsx`; pure math in `dialog-fit.ts`) |
| `export` | `ExportFormat` / `ExportFormatOption` / `EXPORT_FORMATS` / `formatToExtension` / `Exportable` — the pure host-agnostic export contract |
| `export-controller` | `createExportController` — owns overlay state, key handling, a temp `priority: 2` enter layer, clipboard write, and the `copied!` flash |
| `export-overlay` | `ExportOverlay` — presentational format/destination picker popup |
| `export-result-overlay` | `ExportResultOverlay` — presentational file-save result popup (Close / Open) |
| `export-state` | `exportKeyAction`, `cycleExportIndex` — pure key→action / selection math |
| `copied-flash` | `CopiedFlash` — reactive `copied!` footer flash (`<Show>`-based) |
| `file` | `exportFilePath`, `timestamp`, `writeFile`, `EXPORT_BASE_DIR` — export file-write helpers |
| `help` | `buildHelpRows`, `buildFooter` — pure shortcut-table / footer row builders |
| `help-overlay` | `HelpOverlay` — popup shortcut-help overlay |
| `open-folder` | `openFolder`, `resolveOpenFolderCommand` — open a dir in the OS file manager |

## Export foundation (reference)

wlib ships a **generic** export contract that every plugin reuses; it does NOT ship feature serializers. Implementers supply only the `Exportable`:

```ts
interface Exportable {
  formats: ExportFormatOption[] // e.g. [{ id: "markdown", label: "Markdown" }, { id: "csv", label: "CSV" }, { id: "json", label: "JSON" }, { id: "text", label: "Plain text" }]
  build(format: ExportFormat): string
}
```

- `EXPORT_FORMATS` lists the four supported formats (markdown / csv / json / text) in display order.
- `createExportController(api, exportable, { name, exportDir? })` runs the whole flow — format → destination (clipboard vs file) → result — via a temporary `priority: 2` key layer, clipboard write, and `copied!` flash. It exposes `open()`, `handleKey()`, `renderOverlay()`, `renderResultOverlay()`, `copiedFlash()`, `onCopied()`.
- The **feature serializer** (e.g. the actual usage/markdown builder) lives in the consuming plugin, NOT in wlib. wlib only provides the contract + the controller/overlays.

## Import rules (MUST)

- Import directly: `import { x } from "./wlib/<module>"` — never `export { x } from "./wlib/<module>"`. The plugin runtime transpiler **drops re-exports** and the names end up undefined.
- Never create a sibling file with the same base name (`.ts` vs `.tsx`) — host resolution may pick the wrong one.
- For theme colors: values are `ThemeColorValue` (`string | RGBA`) — pass objects through, never string-coerce.

## Submodule upkeep

- Bump: `git submodule update --remote --merge` at repo root, then commit the pointer change.
- If the submodule working tree is dirty and the merge refuses: `git -C persona-injector/wlib fetch origin && git -C persona-injector/wlib reset --hard origin/main` (only after confirming no local work).
- Keep the deployed copy in sync via the `deploy` skill (rsync mirror of `persona-injector/` excludes tests + preserves runtime artifacts) — do NOT use raw `cp -r persona-injector/wlib …`, it ships test files and can clobber runtime artifacts.
- wlib source lives in the `opencode-wlib` repo — never edit its files only inside the submodule; upstream changes there first.

## Blockers (MUST NOT)

- Duplicating wlib functionality locally (scroll/keys/theme/log/reload/clipboard/dialog/system/export/export-overlay/help/help-overlay/file/open-folder/copied-flash) — shared code lives in wlib, nowhere else
- Re-export patterns from wlib modules
- Committing a submodule bump without the deployed copy in sync

## References
- `architecture` — the no-duplication rule
- `plugin-development` — dialogs and server wiring use these helpers
- `deploy` — syncing `wlib/` (and the rest of `persona-injector/`) to the live folder
- https://github.com/Wikijito7/opencode-wlib — the source repo