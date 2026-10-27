/** @jsxImportSource @opentui/solid */
/**
 * Persona selection dialog — shared by the v1 and v2 entrypoints.
 *
 * It consumes only the host-agnostic `WlibHost` adapter (built by
 * `createV1Host` / `createV2Host`), never a raw plugin API, so a single
 * implementation serves both host generations without mixing their APIs.
 */
import type { WlibHost } from "./wlib/src/host/types"
import { onMount, onCleanup, createSignal } from "solid-js"
import { writeConfig, PERSONAS_DIR } from "./config"
import { createPersonaSelectionPersister } from "./persona-selection"
import { createDialogOwnership, persistAndCloseIfOwned, closeIfOwned } from "./dialog-ownership"
import { makeScrollState } from "./wlib/src/core/scroll"
import { registerDialogKeyLayer } from "./wlib/src/core/keys"
import { DialogShell } from "./wlib/src/ui/dialog"
import type { PersonaMeta } from "./types"
import { personaDialogMaxHeight } from "./persona-dialog-fit"

export function openPersonaDialog(
  host: WlibHost,
  notify: (message: string) => void,
  onPersonaChanged: (id: string | null) => void,
  personas: () => PersonaMeta[],
  activeId: () => string | null,
) {
  const { fg, muted, red, primary, selectedText } = host.theme()

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  const scroll = makeScrollState(createSignal)

  let cleanupKeyLayer: (() => void) | null = null

  /**
   * Ownership guard for the async Enter path.
   *
   * Persisting a selection is awaited, but the dialog can be dismissed
   * (escape, backdrop click), replaced by another dialog, or disposed while
   * that write is still in flight. Whichever happens first invalidates the
   * token via the host `show`'s `onClose` callback (fired on dismiss AND on
   * replacement) and via `onCleanup` (fired on disposal). A late write
   * resolution therefore only closes the dialog it belongs to — it never
   * clears a newer dialog that took its place.
   */
  const ownership = createDialogOwnership()

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
      const idx = selectable.findIndex((s) => s.id === active)
      setSelectedIndex(idx >= 0 ? idx : 0)
    } else {
      setSelectedIndex(0) // "Disabled" row
    }
  }

  /**
   * Persist the selection and reflect it locally.
   *
   * The persister carries an in-flight guard: a second Enter while a write is
   * pending is ignored outright (resolves `false`), so repeated keypresses
   * cannot start concurrent writes or emit duplicate success/failure actions.
   * Returns `true` only when the write succeeded — a rejected write keeps the
   * dialog open (with the inline error) so the user can retry.
   */
  const persistSelection = createPersonaSelectionPersister({
    write: writeConfig,
    labelFor: (personaId) => personas().find((p) => p.id === personaId)?.displayName,
    setError: (message) => setError(message),
    notify,
    onPersonaChanged,
  })

  async function selectPersona(id: string | null): Promise<boolean> {
    return persistSelection(id)
  }

  function getSelectedId(): string | null {
    const selectable = getSelectableItems()
    return selectable[selectedIndex()]?.id ?? null
  }

  async function handleKey(key: string): Promise<boolean> {
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
      // A stale Enter (queued before this dialog was dismissed/replaced) must
      // neither start a write for a dead dialog nor close whatever is current.
      // The ownership check after the await ensures a write that resolves after
      // the dialog was dismissed or replaced does NOT clear the newer dialog.
      const id = getSelectedId()
      await persistAndCloseIfOwned(ownership, () => selectPersona(id), () => host.dialog.clear())
      return true
    }
    return false
  }

  ownership.activate()
  host.dialog.show(() => {
    const dialogMaxHeight = personaDialogMaxHeight(personas().length)
    onMount(() => {
      cleanupKeyLayer = registerDialogKeyLayer(host, {
        bindings: [
          { key: "up",      cmd: "persona.up",      desc: "Move up" },
          { key: "down",    cmd: "persona.down",    desc: "Move down" },
          { key: "enter",   cmd: "persona.select",  desc: "Select" },
          { key: "escape",  cmd: "persona.close",   desc: "Close" },
        ],
        commands: [
          { name: "persona.up",      title: "Move Up",   run: async () => { await handleKey("up") } },
          { name: "persona.down",    title: "Move Down", run: async () => { await handleKey("down") } },
          { name: "persona.select",  title: "Select",    run: async () => { await handleKey("enter") } },
          { name: "persona.close",   title: "Close",     run: async () => { closeIfOwned(ownership, () => host.dialog.clear()) } },
        ],
      })

      loadData()
    })

    onCleanup(() => {
      // Disposal is the host-agnostic invalidation: whether the dialog closed
      // by escape/clear or was replaced, this component unmounts and any
      // pending write must no longer be allowed to clear whatever is current.
      ownership.invalidate()
      if (cleanupKeyLayer) {
        try { cleanupKeyLayer() } catch { /* ignore */ }
        cleanupKeyLayer = null
      }
    })

    return (
      <DialogShell
        host={host}
        title="Persona Injector"
        subtitle="— Select persona"
        fg={fg}
        muted={muted}
        scroll={scroll}
        footer={<text fg={muted}>↑↓ navigate · enter select · esc close</text>}
        desired={{ size: "medium", maxHeight: dialogMaxHeight }}
      >
        {loading() ? (
          <text fg={muted}>Loading personas…</text>
        ) : (
          <box flexDirection="column" gap={1}>
            {error() ? (
              <box flexDirection="column" gap={1}>
                <text fg={red}><b>Error</b></text>
                <text fg={muted}>{error()}</text>
              </box>
            ) : null}
            {personas().length === 0 ? (
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
          </box>
        )}
      </DialogShell>
    )
  }, () => ownership.invalidate())
}
