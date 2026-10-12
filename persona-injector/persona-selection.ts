/**
 * Host-independent persona-selection persistence.
 *
 * Extracted from `dialog.tsx` so the persistence/rejection behaviour is
 * unit-testable without importing any UI runtime (`solid-js`, `@opentui/solid`)
 * or a host adapter. Every side effect is injected, so this module is pure — it
 * imports types only.
 */
import type { PersonaInjectorConfig } from "./types"

export interface PersonaSelectionDeps {
  /** Persist the selection (the real implementation is `writeConfig`). */
  write: (config: PersonaInjectorConfig) => Promise<void>
  /** Resolve a persona id to its display name (for notifications). */
  labelFor: (id: string) => string | undefined
  /** Set (or clear) the dialog's inline error. */
  setError: (message: string | null) => void
  /** Emit a user-facing notification. */
  notify: (message: string) => void
  /** Reflect a successfully-persisted selection in the caller's state. */
  onPersonaChanged: (id: string | null) => void
}

/**
 * Best-effort formatting of an arbitrary thrown value that never throws.
 *
 * A hostile rejection is not an `Error`: it can be a revoked `Proxy`, an object
 * with a throwing `toString`/`Symbol.toPrimitive`, or a cross-realm thing for
 * which `String(err)` itself throws. Even reading `.message` is unsafe behind a
 * proxy, so the whole read is guarded — a rejected write must always become a
 * readable inline error, never a second throw.
 */
function describeError(err: unknown): string {
  try {
    if (err instanceof Error && typeof err.message === "string") return err.message
    return String(err)
  } catch {
    return "<unprintable error>"
  }
}

/**
 * Resolve a persona id to its display label, falling back to the id, without
 * ever throwing — a broken `labelFor` must not abort persistence.
 */
function safeLabel(id: string | null, labelFor: (id: string) => string | undefined): string | null {
  if (!id) return null
  try {
    return labelFor(id) ?? id
  } catch {
    return id
  }
}

/**
 * Run a UI side effect without letting it reject the command.
 *
 * `setError`, `notify` and `onPersonaChanged` are the caller's UI concerns, not
 * part of the persistence contract. They are best-effort: a UI bug must never
 * reject a command, turn a persisted selection into a reported failure, or make
 * a failed write look successful.
 */
function bestEffort(action: () => void): void {
  try {
    action()
  } catch {
    // Intentionally swallowed — UI reflection cannot change the write outcome.
  }
}

/**
 * Persist a persona selection, reflecting the outcome to the UI.
 *
 * The `write` is the sole authority on persistence:
 *
 * - Resolves `true` only when the write succeeded. Once it resolves, the
 *   selection IS persisted, so the function still resolves `true` even if a
 *   subsequent UI side effect (`onPersonaChanged`/`notify`) throws — a UI bug
 *   must not masquerade as a persistence failure.
 * - A rejected write must never look like persistence succeeded: it records the
 *   inline error, emits a failure notification, and resolves `false` WITHOUT
 *   calling `onPersonaChanged` — so the caller keeps the dialog open (with the
 *   inline error) for a retry.
 *
 * The function never rejects; a hostile thrown value or a throwing UI callback
 * only changes the resolved boolean and the recorded error, never the promise
 * state.
 */
export async function persistPersonaSelection(
  id: string | null,
  deps: PersonaSelectionDeps,
): Promise<boolean> {
  const label = safeLabel(id, deps.labelFor)

  bestEffort(() => deps.setError(null))
  try {
    await deps.write({ persona: id })
  } catch (err) {
    bestEffort(() => deps.setError(`Could not save persona selection: ${describeError(err)}`))
    bestEffort(() => deps.notify(id ? `Failed to enable ${label}` : "Failed to disable persona"))
    return false
  }

  // The write succeeded: the selection is persisted regardless of whether the
  // UI can reflect it. Each side effect is isolated so one throwing callback
  // neither skips the other nor rejects the command.
  bestEffort(() => deps.onPersonaChanged(id))
  bestEffort(() => deps.notify(id ? `${label} enabled` : "Persona disabled"))
  return true
}

/**
 * Build a guarded persona-selection persister.
 *
 * The returned function wraps `persistPersonaSelection` with an in-flight
 * guard: while a write is pending, further calls resolve `false` immediately
 * without writing or emitting any success/failure action. That is what stops a
 * repeated Enter from starting concurrent writes or emitting duplicate
 * notifications — and because the guard resolves `false`, the caller keeps the
 * dialog open instead of closing on a write it never attempted.
 *
 * Construct once per dialog instance (the guard state is closure-local).
 */
export function createPersonaSelectionPersister(
  deps: PersonaSelectionDeps,
): (id: string | null) => Promise<boolean> {
  let inFlight = false
  return async (id) => {
    if (inFlight) return false
    inFlight = true
    try {
      return await persistPersonaSelection(id, deps)
    } finally {
      inFlight = false
    }
  }
}
