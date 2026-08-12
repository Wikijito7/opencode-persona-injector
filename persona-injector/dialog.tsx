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
  const primary = theme?.primary ?? "#4f46e5"
  const selectedText = (theme as any)?.selectedListItemText

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const scroll = makeScrollState(createSignal)

  let cleanupKeyLayer: (() => void) | null = null

  // Build list of selectable items (excludes template personas)
  // Index 0 = "Disabled" (null persona), then non-template personas in order
  function getSelectableItems(): { displayIndex: number; id: string | null }[] {
    const items: { displayIndex: number; id: string | null }[] = []
    items.push({ displayIndex: 0, id: null }) // "Disabled" row
    const all = personas()
    for (let i = 0; i < all.length; i++) {
      if (!all[i].id.startsWith("_")) {
        items.push({ displayIndex: i + 1, id: all[i].id }) // +1 because row 0 is Disabled
      }
    }
    return items
  }

  function loadData() {
    setLoading(false)
    setError(null)
    const active = activeId()
    if (active) {
      const selectable = getSelectableItems()
      const idx = selectable.findIndex(s => s.id === active)
      setSelectedIndex(idx >= 0 ? idx : 0)
    } else {
      setSelectedIndex(0) // "Disabled" row
    }
  }

  async function selectPersona(id: string | null) {
    await writeConfig({ persona: id })
    onPersonaChanged(id)
    api.ui.toast({ message: id ? `Persona: ${id}` : "Persona deactivated" })
  }

  function getSelectedId(): string | null {
    const selectable = getSelectableItems()
    return selectable[selectedIndex()]?.id ?? null
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
      const max = getSelectableItems().length - 1
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
            (() => {
              // Selectable items map selectable-index -> visual row index
              const selectable = getSelectableItems()
              const current = selectable[selectedIndex()]
              return (
                <box paddingBottom={1}>
                  {/* Disabled row (displayIndex 0) */}
                  {current?.displayIndex === 0 ? (
                    <box backgroundColor={primary}>
                      <text fg={selectedText}>None</text>
                    </box>
                  ) : (
                    <text fg={muted}>None</text>
                  )}

                  {/* Persona rows */}
                  {personas().map((p, i) => {
                    const displayIndex = i + 1
                    const isSelected = current?.displayIndex === displayIndex
                    const isActive = p.id === activeId()
                    const isTemplate = p.id.startsWith("_")
                    const color = p.color
                    const suffix = (isActive ? ` (active)` : "") + (isTemplate ? ` [disabled]` : "")
                    if (isSelected) {
                      return (
                        <box backgroundColor={primary}>
                          <text fg={selectedText}>{p.displayName}{suffix}</text>
                        </box>
                      )
                    }
                    return (
                      <text fg={isActive ? color : muted}>
                        {p.displayName}{suffix}
                      </text>
                    )
                  })}
                </box>
              )
            })()
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
