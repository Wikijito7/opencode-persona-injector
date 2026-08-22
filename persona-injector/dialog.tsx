/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { onMount, onCleanup, createSignal } from "solid-js"
import { homedir } from "node:os"
import { writeConfig } from "./config"
import { makeScrollState } from "./wlib/scroll"
import { registerDialogKeyLayer } from "./wlib/keys"
import { resolveThemeColors } from "./wlib/theme"
import { DialogShell } from "./wlib/dialog"
import type { PersonaMeta } from "./types"
import { personaDialogMaxHeight } from "./persona-dialog-fit"

const PERSONAS_DIR = `${homedir()}/.config/opencode/personas`

export function openPersonaDialog(
  api: TuiPluginApi,
  onPersonaChanged: (id: string | null) => void,
  personas: () => PersonaMeta[],
  activeId: () => string | null,
) {
  const { fg, muted, red, primary, selectedText } = resolveThemeColors(api.theme.current)

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
    api.ui.toast({ message: id ? `${personas().find(p => p.id === id)?.displayName ?? id} enabled` : "Persona disabled" })
  }

  function getSelectedId(): string | null {
    const selectable = getSelectableItems()
    return selectable[selectedIndex()]?.id ?? null
  }

  function handleKey(key: string) {
    if (key === "up") {
      const current = selectedIndex()
      if (current > 0) {
        setSelectedIndex(current - 1)
        scroll.scrollToTop()
      }
      return true
    }
    if (key === "down") {
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
    const dialogMaxHeight = personaDialogMaxHeight(personas().length)
    onMount(() => {
      cleanupKeyLayer = registerDialogKeyLayer(api, {
        bindings: [
          { key: "up",      cmd: "persona.up",      desc: "Move up" },
          { key: "down",    cmd: "persona.down",    desc: "Move down" },
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

    return (
      <DialogShell
        api={api}
        title="Persona Injector"
        subtitle="— Select persona"
        fg={fg}
        muted={muted}
        scroll={scroll}
        footer={<text fg={muted}>↑↓ navigate · enter select · esc close</text>}
        desired={{ size: "medium", maxHeight: dialogMaxHeight }}
        onSizeChange={(size) => api.ui.dialog.setSize(size)}
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
                <box paddingLeft={1} paddingRight={1} backgroundColor={current?.displayIndex === 0 ? primary : undefined}>
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={activeId() === null ? (current?.displayIndex === 0 ? selectedText : primary) : muted}>
                      {activeId() === null ? "●" : " "}
                    </text>
                    <text fg={current?.displayIndex === 0 ? selectedText : activeId() === null ? primary : muted}>None</text>
                  </box>
                </box>

                {/* Persona rows */}
                {personas().map((p, i) => {
                  const displayIndex = i + 1
                  const isSelected = current?.displayIndex === displayIndex
                  const isActive = p.id === activeId()
                  const isTemplate = p.id.startsWith("_")
                  const suffix = isTemplate ? " [disabled]" : ""
                  return (
                    <box paddingLeft={1} paddingRight={1} backgroundColor={isSelected ? primary : undefined}>
                      <box flexDirection="row" gap={1}>
                        <text flexShrink={0} fg={isActive ? (isSelected ? selectedText : primary) : muted}>
                          {isActive ? "●" : " "}
                        </text>
                        <text fg={isSelected ? selectedText : isTemplate ? muted : isActive ? primary : muted}>
                          {p.displayName}{suffix}
                        </text>
                      </box>
                    </box>
                  )
                })}
              </box>
            )
          })()
        )}
      </DialogShell>
    )
  })
}
