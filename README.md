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
| Discovery | auto-discovered plugin **directory** under `plugins/`; optionally declared in `cli.json` `plugins` | auto-loaded server file + `tui.json` `plugin` entry |
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

The v2 host auto-discovers any **directory** placed in `~/.config/opencode/plugins/` (or a project's `.opencode/plugins/`) and resolves its `index.ts` (server) and `tui.tsx` (TUI) entrypoints. Dropping `persona-injector/` in the plugins directory is enough — no config file is required.

You can also declare it explicitly in `~/.config/opencode/cli.json` (schema `https://opencode.ai/v2/cli.json`):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["./plugins/persona-injector"]
}
```

Relative paths resolve against the `cli.json` location. `cli.json` is the v2 replacement for v1's `tui.json`.

> **Legacy auto-load hazard**: v2 *server* plugin discovery also picks up bare `.ts`/`.js` files in the plugins directory. The deprecated `persona-injector-server.ts` is a v1 module — **do not leave it (or `persona-injector.tsx`) in `plugins/` next to the v2 package**. Choose one generation and deploy only its files.

### v1 (deprecated)

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
│   └── wlib/                         # opencode-wlib shared helpers (git submodule)
├── persona-injector-server.ts        # DEPRECATED v1 server entrypoint
├── persona-injector.tsx              # DEPRECATED v1 TUI entrypoint
├── personas/
│   ├── jungle-mode.json              # Default persona (jungle mode)
│   └── _template.json                # Template (disabled)
└── tests/
    └── persona-injector/
        ├── personas.test.ts
        ├── config.test.ts
        ├── persona-dialog-fit.test.ts
        └── inject.test.ts
```
