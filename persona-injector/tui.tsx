/** @jsxImportSource @opentui/solid */
/**
 * Persona Injector — OpenCode 2.x TUI entrypoint (PRODUCTION).
 *
 * OpenCode v2 (`@opencode/plugin/tui`) exposes the plugin `Context` in
 * `setup(context)`. This entrypoint:
 *
 * - builds the v2 host adapter once (`createV2Host(context)`) and hands it to
 *   every wlib helper — never touches the raw host API,
 * - claims the `prompt.footer.status` + `home.footer.status` slots for the
 *   active-persona indicator (the v2 equivalents of v1 `session_prompt_right`
 *   / `home_prompt_right`),
 * - registers `/persona` (`ctrl+shift+m`) through wlib's host-agnostic
 *   `registerSlashCommand`,
 * - opens the shared persona dialog (which consumes only `WlibHost`).
 *
 * Do NOT import a v1 host API here — the v1 entrypoint lives in
 * `persona-injector.tsx` and uses the deprecated `createV1Host` adapter.
 */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { PersonaPromptIndicator } from "./prompt-indicator"
import { openPersonaDialog } from "./dialog"
import { readConfig, PERSONAS_DIR } from "./config"
import { loadPersonas } from "./personas"
import { createV2Host } from "./wlib/src/host/v2"
import { registerSlashCommand } from "./wlib/src/core/command"
import type { PersonaMeta } from "./types"

export default Plugin.define({
  id: "persona-injector",
  async setup(context) {
    const host = createV2Host(context)

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
        const meta = personas().find((p) => p.id === id)
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

    const notify = (message: string) => context.ui.toast.show({ message })

    // Active-persona indicator in the session and home footers.
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => (
        <PersonaPromptIndicator displayName={activeDisplayName()} color={activeColor()} />
      ),
    })
    context.ui.slot({
      append: "home.footer.status",
      render: () => (
        <PersonaPromptIndicator displayName={activeDisplayName()} color={activeColor()} />
      ),
    })

    // Register the persona command + keybinding.
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
  },
})
