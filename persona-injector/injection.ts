/**
 * Pure persona-injection core for the v2 server entrypoint.
 *
 * No host imports — every side effect that touches the world (config, persona
 * loading, snapshot persistence, logging) is injected, so the whole pipeline
 * is unit-testable with `bun:test` while the entrypoint stays a thin adapter.
 *
 * Behaviour (parity with the v1 `system.transform` pipeline):
 * - persona JSON compatibility + legacy migration (via injected `readConfig`)
 * - title-generator exclusion (`isTitleGenerator`, from wlib)
 * - marker protection + per-call duplicate guard (`PERSONA_MARKER`)
 * - primary/subagent routing (event `agent` first; `detectPrimaryAgent` fallback
 *   only for a genuinely primary agent — never for an unknown subagent id)
 * - system-snapshot sidecar (via injected `writeSnapshot`), only for the
 *   request kinds the host marks snapshot-worthy
 */
import type { PersonaInjectorConfig } from "./types"
import { detectPrimaryAgent, isPrimaryAgentId } from "./agent-detection"
import { isTitleGenerator as defaultIsTitleGenerator } from "./wlib/src/core/system"

/** The canonical marker. The duplicate guard and the snapshot sidecar depend on it. */
export const PERSONA_MARKER = "Instructions from: persona-injector"

/** A system prompt part (structurally compatible with the host `SystemPart`). */
export interface PersonaSystemPart {
  type: "text"
  text: string
  cache?: unknown
  metadata?: unknown
}

/** Structural view of the v2 `session.hook("context")` event. */
export interface PersonaInjectionEvent {
  readonly sessionID?: string
  readonly agent?: string
  system: PersonaSystemPart[]
}

export interface PersonaInjectionDeps {
  /** Resolve the active persona config (injectable for tests). */
  readConfig: () => Promise<PersonaInjectorConfig>
  /** Load the per-agent prompts for a persona (injectable for tests). */
  loadPrompts: (personaId: string) => Promise<Map<string, string>>
  /** Persist the final system prompt (injectable/omittable for tests). */
  writeSnapshot?: (sessionID: string, rawText: string) => Promise<void>
  /**
   * Whether this request may persist the shared system-prompt sidecar that
   * `model-usage` reads. Defaults to `true` (preserves the single-caller
   * contract). The host passes `false` for the `compaction`/`generate` request
   * kinds so their auxiliary system prompts cannot overwrite the primary
   * agent-loop snapshot.
   */
  persistSnapshot?: boolean
  /** Title-generator predicate (defaults to wlib `isTitleGenerator`). */
  isTitleGenerator?: (system: string[]) => boolean
  /** Debug logger (defaults to a no-op). */
  log?: (...args: unknown[]) => void
}

const systemText = (system: PersonaSystemPart[]): string => system.map((part) => part.text).join("\n")

/**
 * Inject the active persona into an event's system prompt.
 *
 * Returns `true` when a persona was injected, `false` otherwise (disabled,
 * title generation, already marked, or no prompt for the resolved agent).
 */
export async function injectPersona(
  event: PersonaInjectionEvent,
  deps: PersonaInjectionDeps,
): Promise<boolean> {
  const log = deps.log ?? (() => {})

  // A broken injected predicate (or a non-function value) must never reject the
  // hook: treat an indeterminate result as "not a title generator" so the
  // normal injection path is preserved.
  let isTitleGen = false
  try {
    isTitleGen = (deps.isTitleGenerator ?? defaultIsTitleGenerator)(event.system.map((part) => part.text))
  } catch (err) {
    log("ERROR in isTitleGenerator:", err instanceof Error ? err.message : String(err))
    isTitleGen = false
  }

  try {
    log("injectPersona — sessionID:", event.sessionID, "agent:", event.agent, "parts:", event.system.length)

    // 1. Resolve active persona (disabled → nothing to do).
    const config = await deps.readConfig()
    const personaId = config.persona
    if (!personaId) return false

    // 2. Skip title generator (defensive — `title` uses its own v2 hook).
    if (isTitleGen) return false

    // 3. Per-call duplicate guard.
    if (systemText(event.system).includes(PERSONA_MARKER)) return false

    // 4. Resolve the agent: authoritative event.agent first. Content detection
    //    is a fallback ONLY for a genuine primary agent — either the host gave
    //    no id, or a known primary id whose persona entry is missing (e.g.
    //    "build" resolved to "plan"). Any other provided id is a subagent and
    //    must never be re-routed to a primary persona by content sniffing.
    const prompts = await deps.loadPrompts(personaId)
    let agent = (event.agent ?? "").toLowerCase()
    let prompt = prompts.get(agent)
    if (!prompt && (!agent || isPrimaryAgentId(agent))) {
      const fallback = detectPrimaryAgent(event.system.map((part) => part.text))
      if (fallback) {
        agent = fallback
        prompt = prompts.get(agent)
      }
    }
    if (!prompt) return false

    // 5. Prepend MARKER + prompt + separator, guarding against an empty array.
    if (event.system.length === 0) {
      event.system.push({ type: "text", text: PERSONA_MARKER + "\n" + prompt + "\n\n---" })
    } else {
      const first = event.system[0]
      event.system[0] = { ...first, text: PERSONA_MARKER + "\n" + prompt + "\n\n---\n\n" + first.text }
    }
    log("injectPersona — injected MARKER for:", agent)
    return true
  } catch (err) {
    log("ERROR in injectPersona:", err instanceof Error ? err.message : String(err))
    return false
  } finally {
    // Persist the final system prompt for observers (model-usage). Skipped for
    // title-generator calls, for non-snapshot request kinds, and never allowed
    // to reject the hook on a broken writer.
    const persist = deps.persistSnapshot ?? true
    if (persist && !isTitleGen && event.sessionID && deps.writeSnapshot) {
      try {
        await deps.writeSnapshot(event.sessionID, systemText(event.system))
      } catch (err) {
        log("ERROR in writeSnapshot:", err instanceof Error ? err.message : String(err))
      }
    }
  }
}
