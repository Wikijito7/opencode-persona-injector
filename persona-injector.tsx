/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal } from "solid-js"
import { homedir } from "node:os"
import { PersonaPromptIndicator } from "./persona-injector/prompt-indicator"
import { openPersonaDialog } from "./persona-injector/dialog"
import { readConfig } from "./persona-injector/config"
import { loadPersonas } from "./persona-injector/personas"
import { registerSlashCommand } from "./persona-injector/wlib/command"
import type { PersonaMeta } from "./persona-injector/types"

const PERSONAS_DIR = `${homedir()}/.config/opencode/personas`

const tui: TuiPlugin = async (api) => {
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
  registerSlashCommand(api, {
    name: "persona.select",
    title: "Select Persona",
    slashName: "persona",
    key: "ctrl+shift+m",
    async run() {
      const fresh = await loadPersonas(PERSONAS_DIR)
      setPersonas(fresh)
      openPersonaDialog(api, onPersonaChanged, personas, activeId)
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "persona-injector",
  tui,
}

export default plugin
