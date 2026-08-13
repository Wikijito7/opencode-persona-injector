# Persona Injector

OpenCode plugin that injects persona prompts into agent system prompts. Supports user-defined persona packs loaded from `~/.config/opencode/personas/`, selectable via `Ctrl+Shift+M` dialog.

## How It Works

### Server (`persona-injector-server.ts`)
Hooks `experimental.chat.system.transform` and `chat.message` to prepend persona text to agent system prompts on every API call.

- **ALL agents** (primary and subagent) — persona injected into system prompt via `system.transform`
- Uses `sessionAgent` bridge populated by `chat.message` + content-based `detectPrimaryAgent` fallback
- Per-call duplicate guard via marker check

### TUI (`persona-injector.tsx`)
Provides a persona selection dialog (`Ctrl+Shift+M` or `/persona`) and a prompt indicator showing the active persona name in its color.

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

## Deployment

Copy to `~/.config/opencode/plugins/` and register in `tui.json`:
```bash
cp persona-injector.tsx persona-injector-server.ts ~/.config/opencode/plugins/
cp -r persona-injector/ ~/.config/opencode/plugins/persona-injector/
cp -r personas/ ~/.config/opencode/personas/
```

In `~/.config/opencode/tui.json`:
```json
{
  "plugin": ["./plugins/persona-injector.tsx"]
}
```

## Structure
```
persona-injector/
├── persona-injector.tsx              # TUI entry point (dialog + indicator)
├── persona-injector-server.ts        # Server entry point (persona injection hooks)
├── persona-injector/
│   ├── types.ts                      # Type definitions
│   ├── config.ts                     # Config read/write + legacy migration
│   ├── personas.ts                   # Persona loader & resolver
│   ├── dialog.tsx                    # Persona selection dialog
│   ├── prompt-indicator.tsx          # Active persona indicator
│   └── wlib/                         # opencode-wlib shared helpers (git submodule)
├── personas/
│   ├── jungle-mode.json              # Default persona (jungle mode)
│   └── _template.json                # Template (disabled)
└── tests/
    └── persona-injector/
        ├── personas.test.ts
        ├── config.test.ts
        └── inject.test.ts
```
