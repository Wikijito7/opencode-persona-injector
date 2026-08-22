---
name: deploy
description: "CRITICAL: Load when syncing repo changes to the live opencode plugins folder (~/.config/opencode/plugins/) so the user can test them. Missing this = stale deployed copy and test files shipped to production. Covers the cp/rsync mapping, exclusions, and runtime artifacts to preserve."
---

## When to use me
- After making changes to plugin code the user wants to test live
- When asked to "sync", "deploy", "copy to live", or "update the deployed copy"
- When new or removed files need to be reflected in the live folder

## Not intended for
- Writing plugin code → use `plugin-development`
- Running tests → use `testing` / `quality-check`

---

## Layout

| Source (repo) | Live destination |
|---|---|
| `persona-injector.tsx` | `~/.config/opencode/plugins/persona-injector.tsx` |
| `persona-injector-server.ts` | `~/.config/opencode/plugins/persona-injector-server.ts` |
| `persona-injector/` (dir) | `~/.config/opencode/plugins/persona-injector/` |
| `tests/`, `.agents/`, `.github/`, `.git*`, `README.md`, `LICENSE`, `tsconfig.json`, `*.test.ts`, `*.bak`, `logs/` | NOT synced |

## Rules (MUST)
- Only productive code ships. Tests (`tests/`, `*.test.ts`) MUST NOT be copied.
- Files removed in the repo are removed in live (`--delete`), but only files present in the repo source AND not excluded. Runtime-generated files named by an `--exclude` rule are always kept.
- Preserve runtime artifacts: `system-snapshots.json` is generated at runtime by wlib (`SYSTEM_SNAPSHOTS_FILE`) INSIDE the live `persona-injector/` dir — it is absent from the repo source, so `--delete` would delete it on every deploy. It MUST be listed in the rsync excludes (it is). Any future runtime-generated file written into the live `persona-injector/` dir must ALSO be added to the rsync excludes; never delete unknown JSON/cache files that appear there at runtime.
- `wlib/` lives INSIDE `persona-injector/`, so it is synced automatically by the same command.
- Do NOT sync the repo-root `personas/` sample packs — the plugin reads personas from `~/.config/opencode/personas` at runtime, not from the plugin dir.
- Restart opencode after syncing (plugins load at startup).

## Sync command

Run from the repo root:

```bash
SRC="$(pwd)"
LIVE="$HOME/.config/opencode/plugins"

# 1) Entry points — cp
cp "$SRC/persona-injector.tsx" "$SRC/persona-injector-server.ts" "$LIVE/"

# 2) Source tree — mirror (adds new files, updates changed, deletes removed), skip tests + artifacts
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

Note: `wlib/` is mirrored because it lives inside `persona-injector/`. The rsync `--delete` flag keeps the live tree in lockstep with the repo, deleting only files that are absent from the repo source AND not covered by an exclude rule. Runtime artifacts (`system-snapshots.json`, `*.log`, and any other runtime-generated file) are preserved because they are named by `--exclude` — verify before assuming a stray file is junk.

## References
- `plugin-development` — entry points and hook wiring
- `wlib` — shared helpers shipped inside `persona-injector/wlib/`