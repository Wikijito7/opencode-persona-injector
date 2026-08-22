---
name: design-system
description: "IMPORTANT: Load when building or reviewing dialog UI, overlays, or visual/interaction choices in this repo. Records settled visual and UX decisions so they are NOT re-litigated in QA/review. Missing this = endless re-flagging of already-decided UI choices."
---

## When to use me
- When building or modifying the persona selection dialog UI (`persona-injector/dialog.tsx`)
- When reviewing UI/UX changes (treat the settled decisions below as closed, not roasts)
- When deciding on overlays, popups, selection/footer styling, or navigation keys

## Not intended for
- Persona file format/schema (JSON pack layout, resolution rules, template handling) → use `persona-schema`
- Module boundaries and layering → use `architecture`
- Test writing → use `testing`
- Plugin entry points/hooks → use `plugin-development`

---

## Theme palette (from `wlib/theme.ts` `resolveThemeColors`)

- Keys consumed by the persona dialog: `fg`, `muted`, `red`, `primary`, `selectedText` (may be `undefined`).
- `background` and `panel` ALSO exist in `wlib/theme.ts` now, but `persona-injector/dialog.tsx` does NOT consume them yet. They are available for future use (e.g. overlays/popup surfaces) — do not assume the dialog reads them today.
- Values are `ThemeColorValue` (`string | RGBA`) — pass through as-is, never string-coerce.

## Selection / highlight convention (settled)

- The selected persona row is a filled "chip": `backgroundColor={primary}` on the row `<box>`, label `<text fg={selectedText}>` (falls back to the default color when `selectedText` is `undefined`).
- Inactive rows: `fg={muted}`, no background.
- NO `>` cursor marker, NO `bold` on selection.
- There is also a `●` active-marker dot (drawn when the row's persona is the currently-enabled persona, distinct from the selection chip).

## Dialog sizing (settled)

- `DialogSize` tiers: `medium` (60) / `large` (88) / `xlarge` (116) via wlib `dialog-fit.ts` (`DIALOG_WIDTHS`) + `useDialogSizing`.
- `opencode-persona-injector` uses the `medium` tier (requested via `desired={{ size: "medium", maxHeight: dialogMaxHeight }}`). Do NOT claim or switch to `large`.

## Root dialog box (settled)

- `paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column" gap={1}` — applied by `DialogShell` (`wlib/dialog.tsx`).

## Footer (settled)

- `↑↓ navigate  ·  enter select  ·  esc close`
- A help overlay was evaluated and DROPPED: the footer already shows the shortcuts, so there is NO `h help` binding. Do not re-add it.

## Overlays (none currently)

- The persona dialog currently has NO overlays.
- Shared `HelpOverlay` and `ExportOverlay` components exist in wlib (`wlib/help-overlay.tsx`, `wlib/export-overlay.tsx`) for future reuse across the network, but they are NOT used here.

## Shared design language (Wokis network)

- The selection chip, theme palette, root-box layout, and sizing tiers are shared across the network plugins (`opencode-model-usage`, `opencode-persona-injector`, …) via the `opencode-wlib` submodule.

## Repo-specific dialog differences (settled)

| Aspect | `opencode-model-usage` | `opencode-persona-injector` |
|--------|------------------------|-----------------------------|
| Dialog size | `large` (88) | `medium` (60) |
| Root box | inlined (not `DialogShell`) | `DialogShell` |
| Nav keys | arrows (analyze tab nav is arrow-only `← →`; scroll arrow-only `↑↓` + `PgUp`/`PgDn`) | `↑↓` |
| Footer | `← → {gran} · ↑↓ scroll · e export · h help` | `↑↓ navigate · enter select · esc close` |
| Overlays | `HelpOverlay` + `ExportOverlay` | none (single-list dialog) |

## References
- `architecture` — where code lives
- `wlib` — shared helpers (theme, dialog sizing, clipboard)
- `plugin-development` — dialog/key wiring