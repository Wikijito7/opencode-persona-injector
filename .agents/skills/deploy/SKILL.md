---
name: deploy
description: "CRITICAL: Load when syncing repo changes to the live opencode plugin folders so the user can test them. Missing this = stale deployed copy or test files in production. Default is one shared root (~/.config/opencode/plugins) discovered by BOTH generations via the dual persona-injector-server.ts export; an isolated v2 HOME ($V2_HOME/.config/opencode/plugins) is optional (data separation only). Covers the package mapping, cli.json discovery, exclusions, and runtime artifacts."
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

## Root model (read this first)

**Default: one shared root.** Both generations auto-discover the plugin from the
normal config root `~/.config/opencode/plugins/`. This is safe because the flat
`persona-injector-server.ts` default export is the official dual-generation shape
`{ id, server, setup }`: v1 uses `server()`, v2 decodes `id` + `setup` and strips the
extra `server` key. The package directory `persona-injector/` holds the TUI entry
(`tui.tsx`) and shared helpers; its v2 server setup lives in `server-setup.ts`, which
is **not** a `server`/`index` entrypoint, so the v2 server scanner drops the directory
(no server entrypoint) and never loads a second server plugin.

- **Shared root layout** — `~/.config/opencode/plugins/`:
  - `persona-injector-server.ts` — the single server entrypoint (dual export) for both generations;
  - `persona-injector.tsx` — the v1 TUI entry (registered in `tui.json`); bare `.tsx` is skipped by the v2 server scanner and by the v2 TUI scanner, so it is inert for v2;
  - `persona-injector/` — the shared package (v2 TUI `tui.tsx`, `server-setup.ts`, helpers, `wlib/`).

**Optional: isolated `HOME` for data separation.** Not required for discovery or
correctness. When you want v2 to keep its persona/config **data** separate, redirect
its default paths with an isolated HOME:

- `ORIG_HOME="${ORIG_HOME:-$HOME}"` is the real HOME captured once (reused on a rerun
  so it never nests `$V2_HOME/.opencode-v2`).
- `V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"` — a **distinct** directory,
  never `$HOME`. Its plugin root is `V2_PLUGINS_ROOT="$V2_HOME/.config/opencode/plugins"`
  and the package lands at `V2_LIVE="$V2_PLUGINS_ROOT/persona-injector"`. The flat dual
  `persona-injector-server.ts` also goes to `$V2_PLUGINS_ROOT` (v2's server entry).
- Point the whole config surface (HOME, `OPENCODE_CONFIG_DIR`, and the XDG roots) at
  that HOME. This is **default path/config isolation, not an OS security sandbox**: the
  v2 process can still reach the v1 root (or any other path) via absolute paths,
  symlinks, or shared mounts — it just never derives its own defaults from the real
  `$HOME`. The plugin's `homedir()`-based paths (personas, config, and the wlib
  system-snapshot sidecar) resolve under the **active process `HOME`**, which is why
  redirecting HOME is what scopes them. **Never** default `V2_HOME` to `$HOME`.

### Guard: v2 must never collapse into the real HOME (MUST)

Before any v2 sync or launch, refuse a `V2_HOME` that resolves to empty or `/` (which
would target the filesystem root) and one that resolves to the original real HOME
through a symlink, a trailing slash, or a lexically collapsing `..` (which would
silently collapse the isolated v2 root onto the normal v1 root). Compare **resolved
physical** paths, not raw strings, and capture `ORIG_HOME` first so a rerun in an
already-redirected shell does not treat the redirected `HOME` as the original.

A plain `cd "$V2_HOME" || printf '%s' "$V2_HOME"` fallback is **not** sufficient: when
the v2 root does not exist yet, `cd` fails and the raw string survives, so a path like
`$ORIG_HOME/.opencode-v2/..` (where `.opencode-v2` does not exist) is compared
literally and slips through — yet it lexically collapses onto `$ORIG_HOME`. Resolve the
nearest **existing** ancestor with `cd -P` and append the remaining not-yet-existing
suffix, rejecting any `..` in that suffix (a missing directory could be a symlink, so
its `..` cannot be physically resolved). Standard shell only — no external tools:

```bash
# resolve_physical: physical (symlink-free) form of a path that may not exist yet.
# Resolves the nearest EXISTING ancestor with `cd -P` and appends the not-yet-existing
# suffix. A `..` in that suffix is REJECTED: the missing directory could be a symlink,
# so `..` cannot be physically resolved and may lexically collapse onto another root.
# Prints the path; returns non-zero on empty input or an unresolvable `..`.
resolve_physical() {
  _rp_in="$1"
  [ -n "$_rp_in" ] || return 1
  case "$_rp_in" in
    /*) _rp_cur="$_rp_in" ;;
    *)  _rp_cur="$PWD/$_rp_in" ;;
  esac
  _rp_phys="$(cd "$_rp_cur" 2>/dev/null && pwd -P)" && { printf '%s' "$_rp_phys"; return 0; }
  _rp_suffix=""; _rp_probe="$_rp_cur"
  while [ ! -d "$_rp_probe" ]; do
    _rp_leaf="${_rp_probe##*/}"; [ -n "$_rp_leaf" ] || _rp_leaf="."
    case "$_rp_leaf" in ..) return 1 ;; esac
    _rp_suffix="/$_rp_leaf$_rp_suffix"
    _rp_probe="${_rp_probe%/*}"; [ -n "$_rp_probe" ] || _rp_probe="/"
  done
  _rp_base="$(cd "$_rp_probe" 2>/dev/null && pwd -P)" || return 1
  printf '%s%s' "$_rp_base" "$_rp_suffix"
}

ORIG_HOME="${ORIG_HOME:-$HOME}"   # real HOME, captured once; reused on rerun
V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"   # distinct default — never $HOME

# GUARD: reject empty/`/`, an unresolvable `..`, and any collapse onto ORIG_HOME.
if ! V2_RESOLVED="$(resolve_physical "$V2_HOME")"; then
  echo "REFUSING: V2_HOME cannot be physically resolved (empty, or a '..' over a missing path)" >&2
  return 1 2>/dev/null || exit 1
fi
if ! ORIG_RESOLVED="$(resolve_physical "$ORIG_HOME")"; then
  echo "REFUSING: ORIG_HOME cannot be physically resolved" >&2
  return 1 2>/dev/null || exit 1
fi
case "$V2_RESOLVED" in
  ""|"/") echo "REFUSING: V2_HOME resolves to empty or the filesystem root" >&2; return 1 2>/dev/null || exit 1 ;;
esac
if [ "$V2_HOME" = "$ORIG_HOME" ] || [ "$V2_RESOLVED" = "$ORIG_RESOLVED" ]; then
  echo "REFUSING: V2_HOME must not resolve to \$HOME (v2 would collapse into the v1 root)" >&2
  return 1 2>/dev/null || exit 1
fi
V2_HOME="$V2_RESOLVED"   # normalize the accepted home to its resolved physical path
```

Run this guard at the top of the v2 sync snippet and again before `opencode2`, before
any destination variable is assigned and before `HOME` is exported.

### Config surface: OPENCODE_CONFIG_DIR vs XDG roots

The isolated home only keeps v2's **default** paths separate if **every**
config-surface variable is anchored under `$V2_HOME`. This is path/config
isolation, not a filesystem sandbox — a process so launched can still open the
real v1 root by absolute path, symlink, or shared mount; the point is that it
never *defaults* there. These are **different knobs** — do not conflate them:

- **`HOME`** — export `HOME="$V2_HOME"` so anything resolving `~` lands inside the
  isolated home.
- **`OPENCODE_CONFIG_DIR`** — OpenCode's explicit config override (NOT an XDG root;
  it does **not** follow XDG). Point it at `$V2_HOME/.config/opencode`, the directory
  that holds `opencode.json(c)` (server) and `cli.json` (TUI).
- **XDG roots** — `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`,
  `XDG_STATE_HOME`, each anchored under `$V2_HOME`: `$V2_HOME/.config`,
  `$V2_HOME/.local/share`, `$V2_HOME/.cache`, `$V2_HOME/.local/state`.

Setting only XDG leaves `OPENCODE_CONFIG_DIR` unset (OpenCode then derives config from
XDG); setting only `OPENCODE_CONFIG_DIR` does not move data/cache/state. Set **both**,
all scoped to `$V2_HOME`. **None** of them may point at the real `~/.config`,
`~/.local`, or `~/.cache`.

## Host generations and what ships

| Generation | Needed in the shared root `~/.config/opencode/plugins/` |
|---|---|
| **both** (shared) | `persona-injector-server.ts` (dual `{ id, server, setup }`) + the `persona-injector/` package (`tui.tsx`, `server-setup.ts`, helpers, `wlib/`) |
| **v1 TUI** | `persona-injector.tsx` (registered in `~/.config/opencode/tui.json`) |

**One shared root is the default and is safe.** OpenCode 2.0.27 *server* discovery
scans both `plugin/` and `plugins/` and admits bare `.ts`/`.js` files; the flat
`persona-injector-server.ts` is admitted and decoded as `{ id, setup }` (extra
`server` stripped). The package directory has no `server`/`index` entrypoint, so it is
dropped by the server scanner and contributes only `tui.tsx` to the v2 TUI scanner.
`persona-injector.tsx` is inert to both v2 scanners (bare `.tsx` is never admitted).
An isolated `$V2_HOME` root is **optional** — use it only for separate data.

The arrangement that is genuinely unsafe would be a package directory that still
resolved a `server` entrypoint (`index.ts`/`server.ts`) alongside the flat dual file —
the server scanner would then admit two conflicting server plugins. That is why the v2
setup lives in the non-entrypoint `server-setup.ts`.

## v2 package layout

```
persona-injector/
├── server-setup.ts              ← v2 server setup (NOT an entrypoint; imported by the flat dual file)
├── tui.tsx                      ← v2 TUI entrypoint
├── dialog.tsx  prompt-indicator.tsx
├── config.ts  personas.ts  types.ts  agent-detection.ts  persona-dialog-fit.ts
├── injection.ts  persona-selection.ts  dialog-ownership.ts
└── wlib/                        ← shared helpers (submodule), synced inside the package
```

The v2 *TUI* scanner discovers the package directory under `plugins/` and resolves
`tui`; the *server* scanner drops the directory (no `server`/`index` entrypoint). The
server comes from the flat `persona-injector-server.ts` at the plugin root. No config
file is required.

Auto-discovery needs no config file: the v2 server scanner admits the flat
`persona-injector-server.ts`, and the v2 TUI scanner admits the `persona-injector/`
package directory. You can also declare the TUI package explicitly in `cli.json`:

```json
// $V2_HOME/.config/opencode/cli.json — TUI
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/persona-injector"]
}
```

A configured local path must be a **directory**; OpenCode 2.0.27 skips a configured
path that points at a bare file — so the flat `persona-injector-server.ts` is reached
by auto-discovery only, never by a configured path. These settings are hand-edited
config — the sync only targets `$V2_LIVE/` (the package) and copies the flat server
file to `$V2_PLUGINS_ROOT/`, so it never touches them; leave them in place.

## Rules (MUST)

- Only productive code ships. Tests (`tests/`, `*.test.ts`) MUST NOT be copied.
- **One shared root is the default.** Ship `persona-injector-server.ts` (dual export),
  `persona-injector.tsx` (v1 TUI), and the `persona-injector/` package into the normal
  `~/.config/opencode/plugins/` root. Both generations discover from there.
- **Never reintroduce a package server entrypoint.** The package must NOT contain
  `index.ts` or `server.ts` — only the non-entrypoint `server-setup.ts`. A resolved
  `server`/`index` entrypoint would make the v2 server scanner load the package as a
  second server plugin alongside the flat dual file.
- **Optional isolated HOME.** Only for separate data: `V2_LIVE` goes to
  `$V2_HOME/.config/opencode/plugins/persona-injector/` **and** the flat dual
  `persona-injector-server.ts` goes to `$V2_PLUGINS_ROOT`. **Never** let `V2_HOME`
  equal `$HOME` (run the guard below).
- Files removed in the repo are removed in live (`--delete`), but only files
  present in the repo source AND not excluded. Runtime-generated files named by an
  `--exclude` rule are always kept.
- Preserve runtime artifacts: `system-snapshots.json` is generated at runtime by
  wlib (`SYSTEM_SNAPSHOTS_FILE`) INSIDE the live `persona-injector/` dir — it is
  absent from the repo source, so `--delete` would delete it on every deploy. It
  MUST be listed in the rsync excludes (it is). Any future runtime-generated file
  written into the live `persona-injector/` dir must ALSO be added to the rsync
  excludes; never delete unknown JSON/cache files that appear there at runtime.
- `wlib/` lives INSIDE `persona-injector/`, so it is synced automatically by the
  same command.
- Do NOT sync the repo-root `personas/` sample packs — the plugin reads personas
  from `~/.config/opencode/personas` at runtime, not from the plugin dir.
- The shared-root sync targets the **normal root** `$HOME/.config/opencode/plugins/`.
  Mirror the whole `persona-injector/` package (no entrypoint is excluded —
  `server-setup.ts` is not an entrypoint, and the package's `tui.tsx` is the v2 TUI
  entry). The flat dual `persona-injector-server.ts` and the v1 `persona-injector.tsx`
  live directly at the root, not inside the package.
- In the **optional isolated** v2 root, the flat dual `persona-injector-server.ts`
  is v2's server entrypoint and MUST be copied to `$V2_PLUGINS_ROOT`; do **not**
  delete it (it is the shared server file, not v1-only debris).
- Register the v1 TUI (`./plugins/persona-injector.tsx`) in `~/.config/opencode/tui.json`;
  register the v2 TUI package in `$V2_HOME/.config/opencode/cli.json` only when using
  the isolated root. Never register the same entrypoint in both generations' configs.
- Restart opencode after syncing (plugins load at startup).

## Shared-root sync command (default)

The default deployment target is the **normal config root**,
`$HOME/.config/opencode/plugins/` — the same root both generations read.

Run from the repo root:

```bash
SRC="$(pwd)"
PLUGINS="$HOME/.config/opencode/plugins"   # the normal config root — both generations read it

mkdir -p "$PLUGINS"

# Flat entrypoints at the plugin root: the dual server file (v1 server() + v2 id/setup)
# and the v1 TUI (registered in tui.json; inert to both v2 scanners).
cp "$SRC/persona-injector-server.ts" "$SRC/persona-injector.tsx" "$PLUGINS/"

# Shared package: v2 TUI entry + server-setup + helpers + wlib/. Mirror it whole —
# no entrypoint is excluded (server-setup.ts is NOT a server/index entrypoint).
rsync -a --delete \
  --exclude '*.test.ts' \
  --exclude '.git' --exclude '.github/' --exclude '.gitignore' \
  --exclude 'tsconfig.json' --exclude 'README.md' --exclude 'LICENSE' \
  --exclude '.agents' \
  --exclude '*.bak' --exclude 'logs' \
  --exclude 'system-snapshots.json' \
  --exclude '*.log' \
  "$SRC/persona-injector/" "$PLUGINS/persona-injector/"
```

Then register `./plugins/persona-injector.tsx` in the **v1** config
`~/.config/opencode/tui.json`.

## Optional: isolated v2 HOME sync command

Only for separate v2 **data** — discovery does not require it. Run from the repo root:

```bash
SRC="$(pwd)"
ORIG_HOME="${ORIG_HOME:-$HOME}"   # real HOME, captured once — reused on rerun so it never nests
V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"   # distinct default — never the real $HOME

# resolve_physical: physical (symlink-free) form of a path that may not exist yet.
# Resolves the nearest EXISTING ancestor with `cd -P` and appends the not-yet-existing
# suffix. A `..` in that suffix is REJECTED: the missing directory could be a symlink,
# so `..` cannot be physically resolved and may lexically collapse onto another root.
# Prints the path; returns non-zero on empty input or an unresolvable `..`.
resolve_physical() {
  _rp_in="$1"
  [ -n "$_rp_in" ] || return 1
  case "$_rp_in" in
    /*) _rp_cur="$_rp_in" ;;
    *)  _rp_cur="$PWD/$_rp_in" ;;
  esac
  _rp_phys="$(cd "$_rp_cur" 2>/dev/null && pwd -P)" && { printf '%s' "$_rp_phys"; return 0; }
  _rp_suffix=""; _rp_probe="$_rp_cur"
  while [ ! -d "$_rp_probe" ]; do
    _rp_leaf="${_rp_probe##*/}"; [ -n "$_rp_leaf" ] || _rp_leaf="."
    case "$_rp_leaf" in ..) return 1 ;; esac
    _rp_suffix="/$_rp_leaf$_rp_suffix"
    _rp_probe="${_rp_probe%/*}"; [ -n "$_rp_probe" ] || _rp_probe="/"
  done
  _rp_base="$(cd "$_rp_probe" 2>/dev/null && pwd -P)" || return 1
  printf '%s%s' "$_rp_base" "$_rp_suffix"
}

# GUARD: refuse a v2 home that resolves to empty or `/` (would target the filesystem
# root), one with a `..` over a missing path (which would lexically collapse), or one
# that collapses onto ORIG_HOME (the v1 root). Runs before ANY destination variable is
# assigned so no destination exists pre-check, and compares against ORIG_HOME — not a
# possibly already-redirected $HOME.
if ! V2_RESOLVED="$(resolve_physical "$V2_HOME")"; then
  echo "REFUSING: V2_HOME cannot be physically resolved (empty, or a '..' over a missing path)" >&2
  return 1 2>/dev/null || exit 1
fi
if ! ORIG_RESOLVED="$(resolve_physical "$ORIG_HOME")"; then
  echo "REFUSING: ORIG_HOME cannot be physically resolved" >&2
  return 1 2>/dev/null || exit 1
fi
case "$V2_RESOLVED" in
  ""|"/") echo "REFUSING: V2_HOME resolves to empty or the filesystem root" >&2; return 1 2>/dev/null || exit 1 ;;
esac
if [ "$V2_HOME" = "$ORIG_HOME" ] || [ "$V2_RESOLVED" = "$ORIG_RESOLVED" ]; then
  echo "REFUSING: V2_HOME must not resolve to \$HOME (v2 would collapse into the v1 root)" >&2
  return 1 2>/dev/null || exit 1
fi
V2_HOME="$V2_RESOLVED"   # normalize the accepted home to its resolved physical path

# Destination variables are assigned only after the guard.
V2_PLUGINS_ROOT="$V2_HOME/.config/opencode/plugins"     # v2 plugin root (holds the package)
V2_LIVE="$V2_PLUGINS_ROOT/persona-injector"            # the v2 package directory (rsync target)

mkdir -p "$V2_PLUGINS_ROOT"

# The v2 server entrypoint is the flat dual file — copy it to the v2 plugin root
# (it is the shared server file for BOTH generations, not v1-only debris; do NOT
# delete it). The package directory supplies the TUI entry.
cp "$SRC/persona-injector-server.ts" "$V2_PLUGINS_ROOT/"

# Mirror the v2 package into $V2_LIVE (=$V2_HOME/.config/opencode/plugins/persona-injector/):
# adds new files, updates changed, deletes removed, skips tests + VCS/docs metadata,
# preserves runtime artifacts.
rsync -a --delete \
  --exclude '*.test.ts' \
  --exclude '.git' --exclude '.github/' --exclude '.gitignore' \
  --exclude 'tsconfig.json' --exclude 'README.md' --exclude 'LICENSE' \
  --exclude '.agents' \
  --exclude '*.bak' --exclude 'logs' \
  --exclude 'system-snapshots.json' \
  --exclude '*.log' \
  "$SRC/persona-injector/" "$V2_LIVE/"
```

To run the v2 install, launch opencode from that isolated HOME — the v2 process
must use `$V2_HOME` for its default config/data paths (path/config isolation, not
an OS security sandbox; see the config-surface section above):

```bash
ORIG_HOME="${ORIG_HOME:-$HOME}"   # capture the real HOME once, before we overwrite it
V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"   # distinct — never $HOME

# resolve_physical: physical (symlink-free) form of a path that may not exist yet.
# Resolves the nearest EXISTING ancestor with `cd -P` and appends the not-yet-existing
# suffix. A `..` in that suffix is REJECTED: the missing directory could be a symlink,
# so `..` cannot be physically resolved and may lexically collapse onto another root.
# Prints the path; returns non-zero on empty input or an unresolvable `..`.
resolve_physical() {
  _rp_in="$1"
  [ -n "$_rp_in" ] || return 1
  case "$_rp_in" in
    /*) _rp_cur="$_rp_in" ;;
    *)  _rp_cur="$PWD/$_rp_in" ;;
  esac
  _rp_phys="$(cd "$_rp_cur" 2>/dev/null && pwd -P)" && { printf '%s' "$_rp_phys"; return 0; }
  _rp_suffix=""; _rp_probe="$_rp_cur"
  while [ ! -d "$_rp_probe" ]; do
    _rp_leaf="${_rp_probe##*/}"; [ -n "$_rp_leaf" ] || _rp_leaf="."
    case "$_rp_leaf" in ..) return 1 ;; esac
    _rp_suffix="/$_rp_leaf$_rp_suffix"
    _rp_probe="${_rp_probe%/*}"; [ -n "$_rp_probe" ] || _rp_probe="/"
  done
  _rp_base="$(cd "$_rp_probe" 2>/dev/null && pwd -P)" || return 1
  printf '%s%s' "$_rp_base" "$_rp_suffix"
}

# GUARD before launching: refuse an empty/`/` home, a `..` over a missing path, or one
# that collapses onto ORIG_HOME. Runs BEFORE `export HOME`.
if ! V2_RESOLVED="$(resolve_physical "$V2_HOME")"; then
  echo "REFUSING: V2_HOME cannot be physically resolved (empty, or a '..' over a missing path)" >&2
  return 1 2>/dev/null || exit 1
fi
if ! ORIG_RESOLVED="$(resolve_physical "$ORIG_HOME")"; then
  echo "REFUSING: ORIG_HOME cannot be physically resolved" >&2
  return 1 2>/dev/null || exit 1
fi
case "$V2_RESOLVED" in
  ""|"/") echo "REFUSING: V2_HOME resolves to empty or the filesystem root" >&2; return 1 2>/dev/null || exit 1 ;;
esac
if [ "$V2_HOME" = "$ORIG_HOME" ] || [ "$V2_RESOLVED" = "$ORIG_RESOLVED" ]; then
  echo "REFUSING: V2_HOME must not resolve to \$HOME (v2 would collapse into the v1 root)" >&2
  return 1 2>/dev/null || exit 1
fi
V2_HOME="$V2_RESOLVED"   # normalize the accepted home to its resolved physical path
export V2_HOME
export HOME="$V2_HOME"
export OPENCODE_CONFIG_DIR="$V2_HOME/.config/opencode"   # explicit config override (NOT XDG)
export XDG_CONFIG_HOME="$V2_HOME/.config"
export XDG_DATA_HOME="$V2_HOME/.local/share"
export XDG_CACHE_HOME="$V2_HOME/.cache"
export XDG_STATE_HOME="$V2_HOME/.local/state"
opencode2   # the v2 binary
```

`OPENCODE_CONFIG_DIR` and the XDG roots are separate knobs, all scoped to `$V2_HOME`
(see the config-surface section above); none may point at the real `~/.config`,
`~/.local`, or `~/.cache`.

The v2 root's `cli.json` (`"plugins": ["./plugins/persona-injector"]`) declares the TUI
package directory; the flat `persona-injector-server.ts` is auto-discovered by the
server scanner. These are hand-edited config and must be left in place across deploys.

## References
- `plugin-development` — entry points and hook wiring
- `wlib` — host adapters and shared helpers shipped inside `persona-injector/wlib/`
- `README.md` — Host generations (v1 vs v2) table
