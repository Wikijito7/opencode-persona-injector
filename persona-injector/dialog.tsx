/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { onMount, onCleanup, createSignal } from "solid-js"
import { homedir } from "node:os"
import { writeConfig } from "./config"
import { makeScrollState } from "./shared/scroll"
import type { PersonaMeta } from "./types"

const PERSONAS_DIR = `${homedir()}/.config/opencode/personas`

export function openPersonaDialog(
  api: TuiPluginApi,
  onPersonaChanged: (id: string | null) => void,
  personas: () => PersonaMeta[],
  activeId: () => string | null,
) {
  const theme = api.theme.current
  const fg = theme?.foreground ?? "#ffffff"
  const muted = theme?.muted ?? "#888888"
  const red = theme?.red ?? "#ef4444"

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const scroll = makeScrollState(createSignal)

  let cleanupKeyLayer: (() => void) | null = null

  function loadData() {
    setLoading(false)
    setError(null)
    const loaded = personas()
    if (activeId()) {
      const idx = loaded.findIndex(p => p.id === activeId())
      setSelectedIndex(idx >= 0 ? idx + 1 : 0)  // +1 for "Disabled" row
    } else {
      setSelectedIndex(0)  // "Disabled" row
    }
  }

  async function selectPersona(id: string | null) {
    await writeConfig({ persona: id })
    onPersonaChanged(id)
    api.ui.toast({ message: id ? `Persona: ${id}` : "Persona disabled" })
  }

  function getSelectedId(): string | null {
    const idx = selectedIndex()
    if (idx === 0) return null  // "Disabled" row
    const p = personas()
    return p[idx - 1]?.id ?? null
  }

  function handleKey(key: string) {
    if (key === "up" || key === "k") {
      const current = selectedIndex()
      if (current > 0) {
        setSelectedIndex(current - 1)
        scroll.scrollToTop()
      }
      return true
    }
    if (key === "down" || key === "j") {
      const max = personas().length  // 0 = Disabled, so max index = personas.length
      const current = selectedIndex()
      if (current < max) {
        setSelectedIndex(current + 1)
        // scroll down
        scroll.handleDown()
      }
      return true
    }
    if (key === "enter") {
      const id = getSelectedId()
      selectPersona(id)
      api.ui.dialog.clear()
      return true
    }
    return false
  }

  api.ui.dialog.replace(() => {
    onMount(() => {
      api.ui.dialog.setSize("medium")

      cleanupKeyLayer = api.keymap.registerLayer({
        bindings: [
          { key: "up",      cmd: "persona.up",      desc: "Move up" },
          { key: "k",       cmd: "persona.up",      desc: "Move up" },
          { key: "down",    cmd: "persona.down",    desc: "Move down" },
          { key: "j",       cmd: "persona.down",    desc: "Move down" },
          { key: "enter",   cmd: "persona.select",  desc: "Select" },
          { key: "escape",  cmd: "persona.close",   desc: "Close" },
        ],
        commands: [
          { name: "persona.up",      title: "Move Up",   run: async () => { handleKey("up") } },
          { name: "persona.down",    title: "Move Down", run: async () => { handleKey("down") } },
          { name: "persona.select",  title: "Select",    run: async () => { handleKey("enter") } },
          { name: "persona.close",   title: "Close",     run: async () => { api.ui.dialog.clear() } },
        ],
      })

      loadData()
    })

    onCleanup(() => {
      if (cleanupKeyLayer) {
        try { cleanupKeyLayer() } catch { /* ignore */ }
        cleanupKeyLayer = null
      }
    })

    // Static heuristic for overflow: more than 8 personas
    const hasOverflow = () => personas().length > 8

    return (
      <box paddingLeft={2} paddingRight={2} paddingBottom={1} flexDirection="column" gap={1}>
        {/* Title bar */}
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={1}>
            <text fg={fg}><b>Persona Injector</b></text>
            <text fg={muted}>— Select persona</text>
          </box>
          <text fg={muted}>esc</text>
        </box>

        {/* More above indicator */}
        <text fg={muted}>{hasOverflow() && scroll.isScrolled() ? "▲ more above" : " "}</text>

        <scrollbox
          ref={(el) => scroll.scrollRef = el}
          flexDirection="column"
          gap={1}
          maxHeight={40}
          scrollbarOptions={{ visible: false }}
        >
          {loading() ? (
            <text fg={muted}>Loading personas…</text>
          ) : error() ? (
            <box flexDirection="column" gap={1}>
              <text fg={red}><b>Error</b></text>
              <text fg={muted}>{error()}</text>
            </box>
          ) : personas().length === 0 ? (
            <text fg={muted}>No personas found in {PERSONAS_DIR}</text>
          ) : (
            <box paddingBottom={1}>
              {/* Disabled row */}
              <text fg={selectedIndex() === 0 ? fg : muted}>
                {selectedIndex() === 0 ? "● " : "  "}
                Disabled
              </text>

              {/* Persona rows */}
              {personas().map((p, i) => {
                const isActive = p.id === activeId()
                const isSelected = selectedIndex() === i + 1
                const isTemplate = p.id.startsWith("_")
                const color = p.color
                return (
                  <text fg={isSelected ? fg : isTemplate ? muted : color}>
                    {isSelected ? "● " : "  "}
                    {p.displayName}
                    {isActive ? ` (active)` : ""}
                    {isTemplate ? ` [disabled]` : ""}
                  </text>
                )
              })}
            </box>
          )}
        </scrollbox>

        {/* More below indicator */}
        <text fg={muted}>{hasOverflow() && !scroll.isAtBottom() ? "▼ more below" : " "}</text>

        {/* Footer */}
        <text fg={muted}>↑↓/jk navigate  ·  enter select  ·  esc close</text>
      </box>
    )
  })
}
