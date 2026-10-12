---
name: deploy
description: "CRITICAL: Load when syncing repo changes to the live opencode plugins folder (~/.config/opencode/plugins/) so the user can test them. Missing this = stale deployed copy, test files in production, or a v1 module auto-loaded by v2. Covers the v2 package mapping, cli.json discovery, exclusions, and runtime artifacts."
---

## When to use me
- After making changes to plugin code the user wants to test live
- When asked to "sync", "deploy", "copy to live", or "update the deployed copy"
- When new or removed files need to be reflected in the live folder
- When switching a user between the v1 and v2 host generations

## Not intended for
- Writing plugin code → use `plugin-development`
- Running tests → use `testing` / `quality-check`

---

## Host generations and what ships

| Generation | Source | Live destination |
|---|---|---|
| **v2** (recommended) | `persona-injector/` (the whole package, incl. `wlib/`) | `~/.config/opencode/plugins/persona-injector/` |
| **v1** (deprecated) | `persona-injector.tsx` + `persona-injector-server.ts` | `~/.config/opencode/plugins/` (files) |
| **v1** (deprecated) | `persona-injector/` (shared modules) | `~/.config/opencode/plugins/persona-injector/` |

**Never deploy both generations into the same `plugins/` folder.** OpenCode v2 *server* discovery loads bare `.ts`/`.js` files directly under `plugins/`; the deprecated `persona-injector-server.ts` is a v1 module and would be auto-loaded (and rejected) by v2. Pick one generation, deploy only its files, and remove the other generation's files from `plugins/`.

## v2 layout

```
~/.config/opencode/plugins/persona-injector/
├── index.ts                     ← v2 server entrypoint
├── tui.tsx                      ← v2 TUI entrypoint
├── dialog.tsx  prompt-indicator.tsx
├── config.ts  personas.ts  types.ts  agent-detection.ts  persona-dialog-fit.ts
└── wlib/                        ← shared helpers (submodule), synced inside the package
```

The v2 host auto-discovers any **directory** under `plugins/` and resolves `index` (server) + `tui` (TUI). No config file is required. Optionally declare it in `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/persona-injector"]
}
```

## Rules (MUST)

- Only productive code ships. Tests (`tests/`, `*.test.ts`) MUST NOT be copied.
- Files removed in the repo are removed in live (`--delete`), but only files present in the repo source AND not excluded. Runtime-generated files named by an `--exclude` rule are always kept.
- Preserve runtime artifacts: `system-snapshots.json` is generated at runtime by wlib (`SYSTEM_SNAPSHOTS_FILE`) INSIDE the live `persona-injector/` dir — it is absent from the repo source, so `--delete` would delete it on every deploy. It MUST be listed in the rsync excludes (it is). Any future runtime-generated file written into the live `persona-injector/` dir must ALSO be added to the rsync excludes; never delete unknown JSON/cache files that appear there at runtime.
- `wlib/` lives INSIDE `persona-injector/`, so it is synced automatically by the same command.
- Do NOT sync the repo-root `personas/` sample packs — the plugin reads personas from `~/.config/opencode/personas` at runtime, not from the plugin dir.
- Restart opencode after syncing (plugins load at startup).

## v2 sync command

Run from the repo root:

```bash
SRC="$(pwd)"
LIVE="$HOME/.config/opencode/plugins"

# Remove any legacy v1 files that v2 would auto-load or that belong to the
# other generation (do this once when migrating v1 → v2).
rm -f "$LIVE/persona-injector.tsx" "$LIVE/persona-injector-server.ts"

# Mirror the v2 package: adds new files, updates changed, deletes removed,
# skips tests + VCS/docs metadata, preserves runtime artifacts.
rsync -a --delete \
  --exclude '*.test.ts' \
  --exclude '.git' --exclude '.github/' --exclude '.gitignore' \
  --exclude 'tsconfig.json' --exclude 'README.md' --exclude 'LICENSE' \
  --exclude '.agents' \
  --exclude '*.bak' --exclude 'logs' \
  --exclude 'system-snapshots.json' \
  --exclude '*.log' \
  "$SRC/persona-injector/" "$LIVE/persona-injector/"
```

## v1 (deprecated) sync command

```bash
SRC="$(pwd)"
LIVE="$HOME/.config/opencode/plugins"

cp "$SRC/persona-injector.tsx" "$SRC/persona-injector-server.ts" "$LIVE/"

rsync -a --delete \
  --exclude '*.test.ts' \
  --exclude '.git' --exclude '.github/' --exclude '.gitignore' \
  --exclude 'tsconfig.json' --exclude 'README.md' --exclude 'LICENSE' \
  --exclude '.agents' \
  --exclude '*.bak' --exclude 'logs' \
  --exclude 'system-snapshots.json' \
  --exclude '*.log' \
  "$SRC/persona-injector/" "$LIVE/persona-injector/"
```

Then register `./plugins/persona-injector.tsx` in `~/.config/opencode/tui.json`.

## References
- `plugin-development` — entry points and hook wiring
- `wlib` — host adapters and shared helpers shipped inside `persona-injector/wlib/`
- `README.md` — Host generations (v1 vs v2) table
