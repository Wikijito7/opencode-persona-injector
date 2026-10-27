# Persona Injector

OpenCode plugin that injects persona prompts into agent system prompts. Supports user-defined persona packs loaded from `$HOME/.config/opencode/personas/`, selectable via `Ctrl+Shift+M` dialog. Paths resolve from the **process `HOME`** at runtime (`homedir()`), so both host generations share one normal config root by default; an isolated `HOME` is supported only when you want separate persona/config data.

Targets **OpenCode 2.x** (`@opencode/plugin` + `@opencode/plugin/tui`) and **OpenCode 1.19** from the same plugin root: the flat `persona-injector-server.ts` default export is the official dual-generation `{ id, server, setup }` shape, so both generations auto-discover it from `~/.config/opencode/plugins/` — see [Host generations](#host-generations-v1-vs-v2).

## How It Works

### Server (`persona-injector-server.ts` dual export → `persona-injector/server-setup.ts` for v2)
The flat root `persona-injector-server.ts` is the **single server entrypoint** for both generations (its default export is `{ id, server, setup }`). v1 calls `server()`; v2 decodes `id` + `setup` and ignores the extra `server` key. v2's setup registers the **session context hook** (`ctx.session.hook("context")`, plus `compaction` and `generate`) and prepends persona text to the system prompt before every provider dispatch.

- **ALL agents** (primary and subagent) — the hook event carries the authoritative `agent` id, so routing needs no content sniffing (content detection is kept as a fallback)
- Deliberately does **not** register the `title` hook, so title generation never receives a persona (the `isTitleGenerator` guard is kept as a backstop)
- Per-call duplicate guard via the `Instructions from: persona-injector` marker
- Persists the final system prompt to the shared sidecar (`wlib/system`) so model-usage can read it

### TUI (`persona-injector/tui.tsx`)
Provides a persona selection dialog (`Ctrl+Shift+M` or `/persona`) and a prompt indicator showing the active persona name in its color.

- Claims the v2 `prompt.footer.status` + `home.footer.status` slots (the v2 equivalents of v1 `session_prompt_right` / `home_prompt_right`)
- Registers `/persona` through wlib's host-agnostic `registerSlashCommand`
- Builds the v2 host adapter once (`createV2Host(context)`) and hands it to every wlib helper

## Personas

Personas are JSON files in `$HOME/.config/opencode/personas/`. The path follows the **process `HOME`** (`homedir()`), so both generations read the same normal root by default (`~/.config/opencode/personas/`); only an explicitly isolated `HOME` moves it:

```json
{
  "displayName": "My Persona",
  "color": "#22c55e",
  "agents": {
    "coordinator": { "prompt": "You are a helpful assistant." },
    "plan": { "prompt": "You are a planning assistant." },
    "developer": { "prompt": "You write code.", "enabled": false }
  }
}
```

- `color` — optional, defaults to `#22c55e`
- `agents.<agent>.enabled` — optional, defaults to `true`
- Files starting with `_` (e.g., `_template.json`) are automatically disabled
- The repo ships with `jungle-mode.json` (the original jungle personas)

## Commands

| Action | Key | Slash Command |
|---|---|---|
| Select Persona | `Ctrl+Shift+M` | `/persona` |

## Config

Config stored at `$HOME/.config/opencode/persona-injector.json` — resolved from the **process `HOME`** (`homedir()`), so both generations use the same normal path by default (an isolated `HOME` moves it under that root):
```json
{ "persona": "jungle-mode" }
```

- `persona: null` or missing → injection disabled
- **Legacy migration**: if old `$HOME/.config/opencode/jungle-mode.json` exists with `enabled: true` (same normal path for both generations), effective persona is `"jungle-mode"` (read-time fallback)

## Host generations (v1 vs v2)

OpenCode has two plugin generations. They use different packages and different host APIs, and **one runtime adapter must never mix them** — but they can be served from one shared config root:

| | OpenCode **v2** | OpenCode **v1** |
|---|---|---|
| Plugin package | `@opencode/plugin`, `@opencode/plugin/tui` | `@opencode-ai/plugin/tui` |
| Server hooks | `ctx.session.hook("context" \| "compaction" \| "generate")` | `experimental.chat.system.transform`, `chat.message` |
| TUI slots | `context.ui.slot({ append: "prompt.footer.status", … })` | `api.slots.register({ slots: { session_prompt_right, … } })` |
| Host adapter | `createV2Host(context)` (`wlib/src/host/v2`) | `createV1Host(api)` (`wlib/src/host/v1`) |
| Discovery | server: auto-discovered **directory** / symlink / bare `.ts`/`.js` file under `plugin/` **or** `plugins/`; TUI: auto-discovered **directory** / symlink-to-directory under `plugins/` only. Optional: `opencode.json(c)` `plugins` (server), `cli.json` `plugins` (TUI) | auto-loaded server file + `tui.json` `plugin` entry |
| Server source | `persona-injector-server.ts` default export `{ id, server, setup }` (v2 uses `id` + `setup`; `server` ignored) | same `persona-injector-server.ts`, using its `server()` |
| TUI source | `persona-injector/tui.tsx` (package dir) | `persona-injector.tsx` (flat root) |

**Same-root dual export (default).** Both generations auto-discover the flat `persona-injector-server.ts` from the normal `~/.config/opencode/plugins/` root. The v2 `setup` is factored into the non-entrypoint helper `persona-injector/server-setup.ts`, so the `persona-injector/` package directory resolves only its TUI entry (`tui.tsx`) — never a second server plugin. v1 uses the same flat file's `server()` and the v1 flat `persona-injector.tsx` TUI.

> An isolated `HOME` (`$V2_HOME`) is **optional** — use it only when you want separate persona/config **data**; it is not required for discovery or correctness.

## Deployment

The plugin is deployed as a **self-contained directory** (it ships its `wlib/` submodule inside it), so no separate `wlib/` copy is needed.

**Default: one shared root.** Both generations auto-discover the flat `persona-injector-server.ts` and the shared `persona-injector/` package from the **same normal `~/.config/opencode/plugins/` root**. The flat file's default export `{ id, server, setup }` makes that safe: v2 loads it as its server (`id` + `setup`, extra `server` ignored), v1 loads it as its server (`server()`), and the package directory contributes only `tui.tsx` to v2 — `server-setup.ts` is not an entrypoint, so v2 resolves no second server plugin.

| Generation | Files needed in `~/.config/opencode/plugins/` |
|---|---|
| **both** (shared) | `persona-injector-server.ts` (dual export) + the shared `persona-injector/` package (`tui.tsx`, `server-setup.ts`, helpers, `wlib/`) |
| **v1 TUI** | `persona-injector.tsx`, registered in `~/.config/opencode/tui.json` |

**Optional: isolated `HOME` for data separation.** Not required for discovery or correctness. If you want v2 to keep its persona/config **data** separate, point a dedicated `$V2_HOME` (`V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"`) at a distinct home; v2's **default** paths then resolve outside the real `~/.config`. This is **default path/config isolation, not an OS security sandbox**: the v2 process can still reach the v1 root (or any other path) through absolute paths, symlinks, or shared mounts — it simply never derives its own default paths from the real `$HOME`. To use it, point the whole config surface at that home before launching:

```bash
ORIG_HOME="${ORIG_HOME:-$HOME}"   # capture the real HOME once, before we overwrite it
V2_HOME="${OPENCODE_V2_HOME:-$ORIG_HOME/.opencode-v2}"   # distinct default — never $HOME

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
# that collapses onto the original HOME (would land the v2 package in the v1 root).
# Run BEFORE `export HOME` below: compare resolved physical paths, so a symlink,
# trailing slash, or lexically collapsing `..` that folds V2_HOME onto the original
# HOME is caught too.
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
```

`OPENCODE_CONFIG_DIR` and the XDG roots are **different knobs** — both must be scoped to `$V2_HOME`. `OPENCODE_CONFIG_DIR` is OpenCode's explicit config override and does **not** follow XDG; the XDG roots (`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`) only relocate their own trees. Set **both**, and never point any of them at the real `~/.config`, `~/.local`, or `~/.cache`. With isolation enabled, v2's default plugin root is `$V2_HOME/.config/opencode/plugins/` (the shared package plus the flat dual `persona-injector-server.ts`); this is optional — the default deployment keeps one shared root (see above).

The plugin's own paths are all **`homedir()`-based**, so they resolve under the **active process `HOME`**: persona packs (`homedir()/.config/opencode/personas/`), config (`homedir()/.config/opencode/persona-injector.json`, plus the legacy `jungle-mode.json` fallback), and the wlib system-snapshot sidecar (`homedir()/.config/opencode/plugins/persona-injector/system-snapshots.json`). The v2 launcher redirects `HOME` (plus `OPENCODE_CONFIG_DIR` and the XDG roots) to `$V2_HOME`; that redirection is what makes the plugin's default config/data paths resolve under its v2 root — it is path/config isolation, **not** a security boundary against reaching v1's files.

```bash
# v2 (recommended): mirror the plugin package into the isolated v2 root only.
# This block is NOT standalone: it requires the v2 launcher/env block ABOVE to
# have run in THIS shell, because that block is what defines V2_HOME and
# ORIG_HOME. Copied on its own, V2_HOME would be empty and the destination would
# expand to `/.config/...` (the filesystem root).
: "${V2_HOME:?run the v2 launcher/env block above first — V2_HOME is unset}"
: "${ORIG_HOME:?run the v2 launcher/env block above first — ORIG_HOME is unset}"

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

# GUARD before defining destinations: resolve both roots and refuse an empty, root,
# `..`-collapsing, or v1-collapsing home, so a stray paste can never write to `/` or
# the v1 root. The nearest existing ancestor is resolved with `cd -P` and the missing
# suffix is appended, so a `..` over a not-yet-existing component cannot slip through.
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

# Destinations are defined only AFTER the guard. V2_PLUGINS_ROOT is the v2 plugin
# root (the directory that holds the package); V2_LIVE is the `persona-injector/`
# package directory itself (the rsync target) — it is NOT the plugin root.
V2_PLUGINS_ROOT="$V2_HOME/.config/opencode/plugins"
V2_LIVE="$V2_PLUGINS_ROOT/persona-injector"

mkdir -p "$V2_PLUGINS_ROOT"

# The v2 server entrypoint is the flat dual file — it must sit at the plugin root,
# next to the package directory (NOT inside it). The package supplies the TUI entry.
cp persona-injector-server.ts "$V2_PLUGINS_ROOT/"

rsync -a --delete \
  --exclude '*.test.ts' --exclude '.git' --exclude '.github/' --exclude '.gitignore' \
  --exclude 'tsconfig.json' --exclude 'README.md' --exclude 'LICENSE' \
  --exclude '.agents' --exclude '*.bak' --exclude 'logs' \
  --exclude 'system-snapshots.json' --exclude '*.log' \
  persona-injector/ "$V2_LIVE/"
```

> The exact sync commands (both generations) and the runtime artifacts they must preserve live in the `deploy` skill. Do **not** use raw `cp -r` — it ships test files and can clobber `system-snapshots.json`. **One shared root is fine**: the flat `persona-injector-server.ts` is a dual-generation export, so v2 loads it as its server and v1 loads it as its server; the `persona-injector/` package directory resolves only `tui.tsx` (its `server-setup.ts` is not an entrypoint), so no second server plugin is admitted.

### v2 discovery

OpenCode 2.0.27 auto-discovers plugins under every config root — the global `~/.config/opencode/` and each project's `.opencode/`. The **server** and **TUI** scanners are different, and that difference decides where the package must live.

**Server (core) auto-discovery** scans the immediate children of **both** the `plugin/` and `plugins/` directories. For each child it admits:

- a **directory** — resolved to its conventional entrypoints: `server.ts` (server, or `index.ts`), `tui.tsx` (TUI) and `rpc.ts` (RPC); a `package.json` `exports`/`main` is honored too;
- a **symlink to a directory** — resolved exactly like its target directory;
- a bare **`.ts`/`.js` file** (or a symlink to one) — legacy auto-discovery loads it as a **server-only** entrypoint with no TUI.

Bare `.tsx` files are **not** auto-discovered by the server scanner.

**TUI auto-discovery** scans the immediate children of the **plural `plugins/` directory only** (never the singular `plugin/`). It admits **directories** and **symlinks to directories**; a bare file — `.ts`, `.js` or `.tsx` — is skipped.

Because only `plugins/` is seen by both scanners, the same-root layout places the **flat dual server file** at the plugin root and the **shared package directory** next to it:

```
~/.config/opencode/plugins/
├── persona-injector-server.ts    ← single server entrypoint (dual export: v1 + v2)
├── persona-injector.tsx          ← v1 TUI entrypoint (inert to both v2 scanners)
└── persona-injector/             ← shared package
    ├── tui.tsx                   ← v2 TUI entrypoint
    ├── server-setup.ts           ← v2 server setup (NOT an entrypoint)
    └── …helpers, wlib/
```

The `persona-injector/` package has no `server`/`index` entrypoint, so the v2 server scanner drops it — no second server plugin. The bare `.tsx` v1 TUI is skipped by the server scanner (bare `.tsx` ignored) and by the TUI scanner (bare files skipped), so it is inert for v2.

> **Why `.tsx`?** On OpenCode 2.0.27 the local plugin loader applies the Solid runtime transform to **`.tsx`/`.jsx`** only. A plugin-local module must therefore be `.tsx` when it contains **JSX** or a **runtime** Solid/OpenTUI import that relies on that rewrite. Pure `.ts` helpers and **type-only** imports stay `.ts` (the server setup `server-setup.ts` has no JSX and only a **type-only** host import, so it is plain `.ts`). This is **not** a blanket rule that every runtime Solid import requires `.tsx`.

Auto-discovery needs no config file. You can also declare the **TUI** package explicitly (v2-only config):

```json
// cli.json — TUI config
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/persona-injector"]
}
```

Relative paths resolve against the declaring config file's own directory (an absolute path or a `file://` URL is also accepted). A configured local path **must resolve to a directory, not a file**: OpenCode 2.0.27 skips a configured path that points at a bare file — the server logs a warning and the TUI drops it silently. The flat `persona-injector-server.ts` (the server entry) is therefore reached by auto-discovery only, never by a configured path; the package directory is configured only for its TUI entry.

> **Same-root note**: a bare `.ts`/`.js` file is admitted by the v2 server scanner as a **server-only** plugin. That is exactly why `persona-injector-server.ts` carries the dual `{ id, server, setup }` default export — v2 decodes `id` + `setup` (the extra `server` key is stripped by the v2 module schema), so the same file serves both generations. The v2 setup lives in `persona-injector/server-setup.ts`, which is **not** a `server`/`index` entrypoint, so the package directory contributes only `tui.tsx` and never a second server plugin.

### v1 (1.19)

> v1 uses the same flat `persona-injector-server.ts` (via its `server()`) and `persona-injector.tsx`. Because the flat server file is the dual export, running v2 from the same root does not create a conflict.

> **Do not hand-copy with `cp -r`** — it ships test files and can overwrite runtime artifacts. Use the exact sync commands in the repo's `deploy` skill instead.

The flat `persona-injector-server.ts` is the **single** server entrypoint for both generations: in one shared root v2 loads its `id` + `setup` and v1 loads its `server()`. The `persona-injector/` package supplies the v2 TUI (`tui.tsx`) and the shared helpers; it no longer holds a server entrypoint (`server-setup.ts` is imported, not discovered). `persona-injector.tsx` is the v1 TUI.

Register the v1 TUI in `~/.config/opencode/tui.json`:
```json
{ "plugin": ["./plugins/persona-injector.tsx"] }
```

## Structure
```
opencode-persona-injector/
├── persona-injector/
│   ├── server-setup.ts               # v2 server setup (non-entrypoint helper; imported by the dual export)
│   ├── tui.tsx                       # v2 TUI entrypoint (slots + command)
│   ├── types.ts                      # Type definitions
│   ├── config.ts                     # Config read/write + legacy migration
│   ├── personas.ts                   # Persona loader & resolver
│   ├── agent-detection.ts            # Shared pure agent-detection fallback
│   ├── injection.ts                  # Pure v2 injection core (context hook pipeline)
│   ├── dialog.tsx                    # Persona selection dialog (host-agnostic via WlibHost)
│   ├── prompt-indicator.tsx          # Active persona indicator (host-agnostic)
│   ├── persona-dialog-fit.ts         # Pure dialog height math
│   ├── persona-selection.ts          # Pure persona-selection persistence seam
│   ├── dialog-ownership.ts           # Pure dialog-ownership guard for async writes
│   └── wlib/                         # opencode-wlib shared helpers (git submodule)
├── persona-injector-server.ts        # dual-generation server entrypoint (default { id, server, setup })
├── persona-injector.tsx              # v1 TUI entrypoint
├── personas/
│   ├── jungle-mode.json              # Default persona (jungle mode)
│   └── _template.json                # Template (disabled)
└── tests/
    └── persona-injector/
        ├── agent-detection.test.ts
        ├── config.test.ts
        ├── personas.test.ts
        ├── injection.test.ts
        ├── persona-dialog-fit.test.ts
        ├── persona-selection.test.ts
        ├── dialog-ownership.test.ts
        ├── v1-server-hook.test.ts
        └── inject.test.ts
```
