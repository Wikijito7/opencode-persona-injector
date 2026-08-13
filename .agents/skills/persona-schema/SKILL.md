---
name: persona-schema
description: "CRITICAL: Load when creating or editing persona JSON packs, or touching `personas.ts` / `types.ts` in this repo. Missing this = silent skips, broken injection, and personas that never appear. Covers the exact persona file format and resolution rules."
---

## When to use me
- When adding a new persona file under `personas/` (or `~/.config/opencode/personas/`)
- When editing `persona-injector/personas.ts` or `persona-injector/types.ts`
- When a persona "doesn't show up" or prompts aren't injected — it's almost always a schema violation

## Not intended for
- Injection pipeline or hooks → use `plugin-development`
- Config read/write precedence → use `architecture`
- Writing tests → use `testing`

---

## Persona JSON format

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

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `displayName` | YES (string) | — | Missing → file silently skipped (warning logged) |
| `agents` | YES (object of `{ prompt, enabled? }`) | — | Every entry needs a string `prompt`; missing → file skipped |
| `color` | no | `#22c55e` | Resolved at load time in `loadPersonas` |
| `agents.<id>.enabled` | no | `true` | Only defaulted for non-template personas |

## Resolution rules (MUST)

- **id** = filename without `.json` extension (e.g. `jungle-mode.json` → `jungle-mode`).
- **Templates**: filenames starting with `_` are auto-disabled — `resolvePersonaPrompt` returns `null` for them regardless of `enabled`, their `enabled` field is left exactly as authored, and they render as `[disabled]` in the dialog. Never ship a selectable persona with a `_` prefix.
- **enabled: false** → prompt resolves to `null` for that agent (disabled per-agent).
- **trimEnd()**: resolved prompts are right-trimmed before injection — no trailing whitespace.
- Personas are sorted by id (`localeCompare`) — dialog order follows that.
- Invalid JSON / missing `displayName` / invalid `agents` → file skipped with `console.warn` (never crashes).

## Agent keys (MUST)

- `agents.<id>` keys must match opencode agent names used at runtime: `coordinator`, `plan`, and subagent names (e.g. `developer`, `explore`, `qa`...). The server resolves the current agent and looks up the prompt by that exact key — a mismatched key means no injection for that agent.
- Unknown keys are harmless (never matched) but dead weight.

## Blockers (MUST NOT)

- Creating a persona with a `_` prefix expecting it to be selectable — templates are never selectable by design
- Omitting `displayName` or `agents` and expecting the file to load
- Putting `enabled: false` on a template expecting it to behave like a normal disabled agent
- Editing `DEFAULT_COLOR` (`#22c55e`) — persona packs and indicator code both rely on it

## References
- `persona-injector/personas.ts` — loader, type guard, resolver
- `persona-injector/types.ts` — `PersonaDefinition`, `PersonaMeta`, `PersonaAgentConfig`
- `personas/jungle-mode.json` — the shipped default persona
- `personas/_template.json` — the disabled template