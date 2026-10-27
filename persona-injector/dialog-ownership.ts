/**
 * Host-independent dialog-ownership guard.
 *
 * A dialog's key handlers can start asynchronous work (persisting a selection)
 * that outlives the dialog itself: the user may press Escape, another dialog
 * may replace it, or the host may dispose it while the write is still in
 * flight. When that work completes it must only act on the dialog that started
 * it — a late completion must never clear a *newer* dialog that took its place.
 *
 * This module is pure (no imports, closure-local state) so the race is
 * unit-testable without any UI runtime or host adapter, mirroring
 * `persona-selection.ts`.
 */

/** Per-dialog ownership token. One instance per open dialog. */
export interface DialogOwnership {
  /** Mark this dialog as the current owner (call immediately before `show`). */
  activate(): void
  /** Release ownership — invoked by the host's `onClose` and by `onCleanup`. */
  invalidate(): void
  /** Whether this dialog is still the current owner. */
  isActive(): boolean
  /**
   * Monotonic ownership generation (epoch).
   *
   * Bumped by every `activate()` and every `invalidate()`. An async operation
   * must capture this value before awaiting and re-check it afterwards: if it
   * changed, the token crossed an ownership boundary (dismissed, replaced, or
   * re-activated as a new epoch) and a result belonging to the old epoch must
   * not act on the current one.
   *
   * `isActive()` alone cannot tell "still the same owner" apart from "dismissed
   * and then re-activated as a fresh epoch" — both read `true`. This can.
   */
  generation(): number
}

/** Create an inactive ownership token. `activate()` it before showing. */
export function createDialogOwnership(): DialogOwnership {
  let active = false
  let generation = 0
  return {
    activate: () => {
      active = true
      generation += 1
    },
    invalidate: () => {
      active = false
      generation += 1
    },
    isActive: () => active,
    generation: () => generation,
  }
}

/**
 * Persist a selection and, only if this dialog still owns the screen at the
 * same ownership epoch once the write resolves, close it.
 *
 * - A stale invocation (the owning dialog was already dismissed/replaced) is
 *   ignored up front: it neither starts a write for a dead dialog nor closes
 *   whatever is current.
 * - The ownership epoch is captured before `persist` is awaited and re-checked
 *   when it resolves. A write that resolves after the dialog was dismissed,
 *   replaced, OR dismissed-and-re-activated resolves `false` and does NOT call
 *   `close`: a later epoch of the same token is a new dialog and must survive a
 *   result produced by an earlier epoch. This is what the generation (rather
 *   than a plain active flag) guards.
 * - A rejected `persist` is treated as a non-close: the rejection is caught,
 *   the dialog is left open, and `false` is resolved. The error display stays
 *   owned by the persister; this guard never surfaces a rejection (so an
 *   Enter command can never reject) and never closes on a failed write.
 * - The `persist` result is still honoured for persistence/notification
 *   purposes by the caller; only the `close` side effect is ownership-gated.
 *
 * @returns `true` only when the dialog was still owned at the same epoch and
 *   actually closed.
 */
export async function persistAndCloseIfOwned(
  ownership: DialogOwnership,
  persist: () => Promise<boolean>,
  close: () => void,
): Promise<boolean> {
  if (!ownership.isActive()) return false
  const epoch = ownership.generation()
  let saved = false
  try {
    saved = await persist()
  } catch {
    // A failed write must not close the dialog nor reject the command; the
    // persister is responsible for the inline error and notification.
    return false
  }
  if (saved && ownership.isActive() && ownership.generation() === epoch) {
    close()
    return true
  }
  return false
}

/**
 * Close the dialog only if it is still the current owner.
 *
 * Guards the synchronous close path (the Escape binding): a stale close left
 * over from a replaced dialog must not clear the newer dialog on screen.
 *
 * @returns `true` when the dialog was still owned and `close` was invoked.
 */
export function closeIfOwned(ownership: DialogOwnership, close: () => void): boolean {
  if (!ownership.isActive()) return false
  close()
  return true
}
