/** @jsxImportSource @opentui/solid */
/**
 * @deprecated OpenCode v1 TUI entrypoint — transition window only.
 *
 * OpenCode 2.x does NOT support `@opencode-ai/plugin/tui`. This entrypoint
 * exists so v1 users keep working while they migrate. It builds the deprecated
 * `createV1Host` adapter and shares the host-agnostic dialog/registration code
 * with the v2 entrypoint (`persona-injector/tui.tsx`); the two host APIs are
 * never mixed in one adapter.
 *
 * Removal is tracked in the v2 cleanup; new work targets `persona-injector/tui.tsx`.
 *
 * v1 selection: register this file via `tui.json` `plugin` (see README).
 */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { PersonaPromptIndicator } from "./persona-injector/prompt-indicator"
import { openPersonaDialog } from "./persona-injector/dialog"
import { readConfig, PERSONAS_DIR } from "./persona-injector/config"
import { loadPersonas } from "./persona-injector/personas"
import { createV1Host } from "./persona-injector/wlib/src/host/v1"
import { registerSlashCommand } from "./persona-injector/wlib/src/core/command"
import type { PersonaMeta } from "./persona-injector/types"

const tui: TuiPlugin = async (api) => {
  // One adapter for the whole runtime — never mixed with the v2 host API.
  const host = createV1Host(api)

  const [personas, setPersonas] = createSignal<PersonaMeta[]>([])
  const [activeId, setActiveId] = createSignal<string | null>(null)
  const [activeDisplayName, setActiveDisplayName] = createSignal<string | null>(null)
  const [activeColor, setActiveColor] = createSignal<string | null>(null)

  // Load initial state
  const [loaded, config] = await Promise.all([
    loadPersonas(PERSONAS_DIR),
    readConfig(),
  ])
  setPersonas(loaded)
  updateActive(config.persona)

  function updateActive(id: string | null) {
    setActiveId(id)
    if (id) {
      const meta = personas().find(p => p.id === id)
      setActiveDisplayName(meta?.displayName ?? id)
      setActiveColor(meta?.color ?? "#22c55e")
    } else {
      setActiveDisplayName(null)
      setActiveColor(null)
    }
  }

  function onPersonaChanged(id: string | null) {
    updateActive(id)
  }

  const notify = (message: string) => api.ui.toast({ message })

  // Register prompt indicator slots
  api.slots.register({
    order: 176,
    slots: {
      session_prompt_right(_ctx, _props) {
        return <PersonaPromptIndicator displayName={activeDisplayName()} color={activeColor()} />
      },
      home_prompt_right(_ctx, _props) {
        return <PersonaPromptIndicator displayName={activeDisplayName()} color={activeColor()} />
      },
    },
  })

  // Register persona command + keybinding
  registerSlashCommand(host, {
    name: "persona.select",
    title: "Select Persona",
    slashName: "persona",
    key: "ctrl+shift+m",
    async run() {
      const fresh = await loadPersonas(PERSONAS_DIR)
      setPersonas(fresh)
      openPersonaDialog(host, notify, onPersonaChanged, personas, activeId)
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "persona-injector",
  tui,
}

export default plugin
