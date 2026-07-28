# Jungle Mode

OpenCode plugin that injects playful jungle-themed personas into agent system prompts and chat messages.

## How It Works

### Server (`jungle-mode-server.ts`)
Hooks `experimental.chat.system.transform` and `chat.message` to prepend persona text to agent prompts on every API call (per-call, not per-session).

- **Primary agents** (coordinator, plan, build) — persona injected into system prompt on every API call
- **Subagents** (developer, testing, qa, reviewer) — persona prepended to first chat message text
- Uses content-based agent detection (`detectPrimaryAgent`) as fallback when hook ordering varies

### TUI (`jungle-mode.tsx`)
Provides a sidebar indicator showing jungle mode status, a `/jungle` toggle command, and a prompt indicator in the session/home prompt bar.

## Personas

| Agent | Persona |
|---|---|
| Coordinator | Warrior Monke 🦧 |
| Plan / Build | Junior Monke 🐵 |
| Developer | Junior Monke Developer 🐵 |
| Testing | Assert Ape 🐒 |
| QA | Quality Quacker 🦆🔍 |
| Reviewer | GOAT Roaster 🐐 |

## Commands

| Action | Key | Slash Command |
|---|---|---|
| Toggle on/off | `Ctrl+Shift+M` | `/jungle` |

The toggle state is persisted to `~/.config/opencode/jungle-mode.json`.

## Structure

```
opencode-persona-injector/
├── jungle-mode.tsx                   # TUI entry point (indicator + toggle)
├── jungle-mode-server.ts             # Server entry point (persona injection hooks)
├── jungle-mode/
│   ├── command.tsx                   # /jungle toggle command + config persistence
│   ├── persona.ts                    # Persona definitions & getPersonaForAgent()
│   ├── prompt-indicator.tsx          # Jungle Mode status indicator
│   └── types.ts                      # Type definitions
└── tests/                            # Unit tests
```
