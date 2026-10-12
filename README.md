# Persona Injector

OpenCode plugin that injects persona prompts into agent system prompts. Supports user-defined persona packs loaded from `~/.config/opencode/personas/`, selectable via `Ctrl+Shift+M` dialog.

Targets **OpenCode 2.x** (`@opencode/plugin` + `@opencode/plugin/tui`). A deprecated OpenCode v1 entrypoint survives the transition window — see [Host generations](#host-generations-v1-vs-v2).

## How It Works

### Server (`persona-injector/index.ts`)
Registers the v2 **session context hook** (`ctx.session.hook("context")`, plus `compaction` and `generate`) and prepends persona text to the system prompt before every provider dispatch.

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

Personas are JSON files in `~/.config/opencode/personas/`:

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

Config stored at `~/.config/opencode/persona-injector.json`:
```json
{ "persona": "jungle-mode" }
```

- `persona: null` or missing → injection disabled
- **Legacy migration**: if old `~/.config/opencode/jungle-mode.json` exists with `enabled: true`, effective persona is `"jungle-mode"` (read-time fallback)

## Host generations (v1 vs v2)

OpenCode has two mutually exclusive plugin generations. They use different packages and different host APIs, and **one runtime adapter must never mix them**:

| | OpenCode **v2** (production) | OpenCode **v1** (deprecated) |
|---|---|---|
| Plugin package | `@opencode/plugin`, `@opencode/plugin/tui` | `@opencode-ai/plugin/tui` |
| Server hooks | `ctx.session.hook("context" \| "compaction" \| "generate")` | `experimental.chat.system.transform`, `chat.message` |
| TUI slots | `context.ui.slot({ append: "prompt.footer.status", … })` | `api.slots.register({ slots: { session_prompt_right, … } })` |
| Host adapter | `createV2Host(context)` (`wlib/src/host/v2`) | `createV1Host(api)` (`wlib/src/host/v1`, deprecated) |
| Discovery | server: auto-discovered **directory** / symlink / bare `.ts`/`.js` file under `plugin/` **or** `plugins/`; TUI: auto-discovered **directory** / symlink-to-directory under `plugins/` only. Optional: `opencode.json(c)` `plugins` (server), `cli.json` `plugins` (TUI) | auto-loaded server file + `tui.json` `plugin` entry |
| Source | `persona-injector/index.ts`, `persona-injector/tui.tsx` | `persona-injector-server.ts`, `persona-injector.tsx` |

Pick **one** generation. The deprecated v1 files are kept only for the transition window and are removed in the follow-up cleanup.

## Deployment

The plugin is deployed as a **self-contained directory** (it ships its `wlib/` submodule inside it), so no separate `wlib/` copy is needed.

```bash
# v2 (recommended): mirror the plugin package only
rsync -a --delete \
  --exclude '*.test.ts' --exclude '.git' --exclude '.github/' --exclude '.gitignore' \
  --exclude 'tsconfig.json' --exclude 'README.md' --exclude 'LICENSE' \
  --exclude '.agents' --exclude '*.bak' --exclude 'logs' \
  --exclude 'system-snapshots.json' --exclude '*.log' \
  persona-injector/ "$HOME/.config/opencode/plugins/persona-injector/"
```

> The exact sync command (and the runtime artifacts it must preserve) lives in the `deploy` skill. Do **not** use raw `cp -r` — it ships test files and can clobber `system-snapshots.json`.

### v2 discovery

OpenCode 2.0.27 auto-discovers plugins under every config root — the global `~/.config/opencode/` and each project's `.opencode/`. The **server** and **TUI** scanners are different, and that difference decides where the package must live.

**Server (core) auto-discovery** scans the immediate children of **both** the `plugin/` and `plugins/` directories. For each child it admits:

- a **directory** — resolved to its conventional entrypoints: `server.ts` (server, or `index.ts`), `tui.tsx` (TUI) and `rpc.ts` (RPC); a `package.json` `exports`/`main` is honored too;
- a **symlink to a directory** — resolved exactly like its target directory;
- a bare **`.ts`/`.js` file** (or a symlink to one) — legacy auto-discovery loads it as a **server-only** entrypoint with no TUI.

Bare `.tsx` files are **not** auto-discovered by the server scanner.

**TUI auto-discovery** scans the immediate children of the **plural `plugins/` directory only** (never the singular `plugin/`). It admits **directories** and **symlinks to directories**; a bare file — `.ts`, `.js` or `.tsx` — is skipped.

Because only `plugins/` is seen by both scanners, the recommended layout is a **single plugin directory under `plugins/`** that holds both entrypoints:

```
~/.config/opencode/plugins/persona-injector/
├── index.ts   ← server entrypoint
└── tui.tsx    ← TUI entrypoint
```

Dropping that one directory in is enough — no config file is required, and both scanners find it.

You can also declare a plugin explicitly. The two generations use different config files:

- **`opencode.json` / `opencode.jsonc`** — the server (core) config, discovered globally and per project (`.opencode/opencode.json(c)`);
- **`cli.json`** — the TUI-only config at `~/.config/opencode/cli.json`, the v2 successor to v1's `tui.json`. The server never reads it.

Both expose a `plugins` array:

```json
// opencode.json — server config
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./plugins/persona-injector"]
}
```

```json
// cli.json — TUI config
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/persona-injector"]
}
```

Relative paths resolve against the declaring config file's own directory (an absolute path or a `file://` URL is also accepted). A configured local path **must resolve to a directory, not a file**: OpenCode 2.0.27 skips a configured path that points at a bare file — the server logs a warning and the TUI drops it silently. Bare `.ts`/`.js` files are only admitted through the auto-discovery above, where they load as **server-only**.

> **Legacy auto-load hazard**: running v2 while v1's loose files sit in a `plugin/`/`plugins/` directory is **not** harmless. A bare `.ts`/`.js` file is admitted by the server scanner as a **server-only** plugin, so `persona-injector-server.ts` (a v1 module) loads as a second, conflicting server plugin. `persona-injector.tsx` is picked up by neither scanner (bare `.tsx` files are ignored by the server scanner, and the TUI scanner skips bare files), so it contributes nothing — but leaving it there is still wrong-generation debris, not a supported state. Choose one generation and deploy only its files; remove the other generation's files from `plugins/`.

### v1 (deprecated)

> These files are for a **v1 host only**. Do not leave them in `plugins/` while running v2 — see the legacy auto-load hazard above. Before migrating to v2, remove `persona-injector.tsx` and `persona-injector-server.ts` from `plugins/`.

```bash
cp persona-injector.tsx persona-injector-server.ts ~/.config/opencode/plugins/
cp -r persona-injector/ ~/.config/opencode/plugins/persona-injector/
cp -r personas/ ~/.config/opencode/personas/
```

In `~/.config/opencode/tui.json`:
```json
{ "plugin": ["./plugins/persona-injector.tsx"] }
```

## Structure
```
opencode-persona-injector/
├── persona-injector/
│   ├── index.ts                      # v2 server entrypoint (session context hook)
│   ├── tui.tsx                       # v2 TUI entrypoint (slots + command)
│   ├── types.ts                      # Type definitions
│   ├── config.ts                     # Config read/write + legacy migration
│   ├── personas.ts                   # Persona loader & resolver
│   ├── agent-detection.ts            # Shared pure agent-detection fallback
│   ├── dialog.tsx                    # Persona selection dialog (host-agnostic via WlibHost)
│   ├── prompt-indicator.tsx          # Active persona indicator (host-agnostic)
│   ├── persona-dialog-fit.ts         # Pure dialog height math
│   ├── persona-selection.ts          # Pure persona-selection persistence seam
│   └── wlib/                         # opencode-wlib shared helpers (git submodule)
├── persona-injector-server.ts        # DEPRECATED v1 server entrypoint
├── persona-injector.tsx              # DEPRECATED v1 TUI entrypoint
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
        └── inject.test.ts
```
