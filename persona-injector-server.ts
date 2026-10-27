/**
 * OpenCode dual-generation server entrypoint (v1 + v2) — same-root compatible.
 *
 * The single default export is the official dual-generation shape
 * `{ id, server, setup }`:
 *
 * - **OpenCode 1.19 (v1)** uses `server()` — the `experimental.chat.system.transform`
 *   / `chat.message` hook map below.
 * - **OpenCode 2.x (v2)** uses `id` + `setup()` and ignores the extra `server`
 *   property (the official v2 schema strips unknown keys). The v2 setup lives in
 *   `persona-injector/server-setup.ts` (a non-entrypoint helper, so the package
 *   directory never resolves a second server plugin).
 *
 * This lets a single flat `plugins/persona-injector-server.ts` auto-discovered by
 * BOTH generations share one normal config root (`~/.config/opencode/plugins/`).
 *
 * The v2 setup is imported as a value but its `@opencode/plugin` `Context` type is
 * imported **type-only** (erased), so v1 — where `@opencode/plugin` is not
 * installed — evaluates no v2 host runtime import.
 */
import { readConfig, PERSONAS_DIR } from "./persona-injector/config"
import { loadPersonas, resolvePersonaPrompt } from "./persona-injector/personas"
import type { PersonaMeta } from "./persona-injector/types"
import { fileURLToPath } from "node:url"
import { createLog } from "./persona-injector/wlib/src/core/log"
import { writeSystemSnapshot, isTitleGenerator } from "./persona-injector/wlib/src/core/system"
import { detectPrimaryAgent } from "./persona-injector/agent-detection"
import { PERSONA_MARKER as MARKER } from "./persona-injector/injection"
import { setup } from "./persona-injector/server-setup"

// Re-exported so the v1 module keeps its public surface (and the inject tests
// keep importing `detectPrimaryAgent` from here). The implementation is shared
// with the v2 server entrypoint via `./persona-injector/agent-detection`.
export { detectPrimaryAgent }

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const LOG_DIR = `${__dirname}logs`

const logger = createLog({ dir: LOG_DIR, fileName: "persona-injector.log" })
const log = logger.log

function snap(label: string, system: string[] | undefined) {
  const text = (system ?? []).join("\n")
  const preview = text.length > 400 ? text.slice(0, 400) + "…<TRUNCATED>" : text
  log(`SNAPSHOT[${label}] len=${text.length}:\n${preview}`)
}

/** Best-effort error message that never throws, so logging can't reject the hook. */
function errorMessage(err: unknown): string {
  try {
    return err instanceof Error ? err.message : String(err)
  } catch {
    return "<unprintable error>"
  }
}

/** Best-effort description of an arbitrary value that never throws. */
function describeValue(value: unknown): string {
  try {
    return typeof value === "string" ? value : String(value)
  } catch {
    return `<unprintable ${typeof value}>`
  }
}

// Map<personaId, Map<agent, prompt>> — persona prompts cached after first load
const personaPromptCache = new Map<string, Map<string, string>>()

/**
 * Loads and caches the per-agent prompts for a given persona.
 *
 * - Returns the cached `Map<agent, prompt>` when the persona was already loaded.
 * - Otherwise loads every persona from `PERSONAS_DIR`, finds the one matching
 *   `personaId`, resolves a prompt for each agent via `resolvePersonaPrompt`,
 *   caches the result, and returns it.
 */
export async function loadPersonaPrompts(
  personaId: string,
): Promise<Map<string, string>> {
  const cached = personaPromptCache.get(personaId)
  if (cached) return cached

  const personas = await loadPersonas(PERSONAS_DIR)
  const meta = personas.find((m: PersonaMeta) => m.id === personaId)
  const prompts = new Map<string, string>()

  if (meta) {
    for (const agent of Object.keys(meta.agents)) {
      const prompt = resolvePersonaPrompt(meta, agent)
      if (prompt) prompts.set(agent, prompt)
    }
  }

  personaPromptCache.set(personaId, prompts)
  log("loadPersonaPrompts — personaId:", personaId, "found meta:", !!meta, "prompts:", [...prompts.keys()])
  return prompts
}

export const PersonaInjectorPlugin = async () => {
  const sessionAgent = new Map<string, string>()

  log("=== PersonaInjectorPlugin initialized ===")

  return {
    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: any },
      output: { system: string[] },
    ) => {
      // Fail closed: only an explicit boolean `false` lets the pipeline
      // continue. `true` skips injection; a thrown or non-boolean predicate is
      // indeterminate, so we skip injection AND the snapshot rather than risk
      // injecting a persona into a title-generation request. The hook never
      // rejects, even when the predicate itself throws.
      let isTitleGen: boolean
      try {
        const result = isTitleGenerator(output.system)
        if (result === true || result === false) {
          isTitleGen = result
        } else {
          log("ERROR in isTitleGenerator: non-boolean result, failing closed:", describeValue(result))
          return
        }
      } catch (err) {
        log("ERROR in isTitleGenerator:", errorMessage(err))
        return
      }

      try {
        log("system.transform FIRED — sessionID:", _input.sessionID, "system length:", output.system?.length)
        snap("system.transform BEFORE", output.system)

        // 1. Resolve active persona from config (with legacy migration fallback)
        const config = await readConfig()
        const personaId = config.persona
        log("readConfig — result:", JSON.stringify(config))
        log("system.transform — personaId:", personaId)
        log("system.transform — model:", JSON.stringify(_input.model))
        if (!personaId) return

        // 2. Skip title generator
        log("system.transform — isTitleGenerator:", isTitleGen)
        if (isTitleGen) return

        // 3. Bail if MARKER already present (per-call duplicate guard)
        const alreadyInjected = output.system.join("\n").includes(MARKER)
        log("system.transform — markerAlreadyPresent:", alreadyInjected)
        if (alreadyInjected) return

        // 4. Determine agent: sessionAgent bridge first, then content detection fallback
        let agent: string | undefined
        if (_input.sessionID) {
          agent = sessionAgent.get(_input.sessionID)
          log("system.transform — bridgedAgent:", agent)
        }
        if (!agent) {
          agent = detectPrimaryAgent(output.system)
        }
        if (!agent) return

        // 5. Look up persona prompt
        const prompts = await loadPersonaPrompts(personaId)
        const prompt = prompts.get(agent)
        log("system.transform — prompt found for:", agent, !!prompt)
        if (!prompt) return
        log("system.transform — prompt preview:", prompt.slice(0, 200))

        // 6. Prepend MARKER + prompt + separator to system[0], guarding against an empty array
        if (output.system.length === 0) {
          output.system.push(MARKER + "\n" + prompt + "\n\n---")
        } else {
          output.system[0] = MARKER + "\n" + prompt + "\n\n---\n\n" + output.system[0]
        }
        log("system.transform — injected MARKER for:", agent)
        snap("system.transform AFTER", output.system)
      } catch (err) {
        log("ERROR in system.transform:", errorMessage(err))
      } finally {
        // Persist the final system prompt (after injection, or the un-injected
        // truth when nothing was injected) so model-usage can read it.
        // Skipped for title-generator calls, and never allowed to reject the
        // hook on a broken writer.
        if (!isTitleGen && _input.sessionID) {
          try {
            await writeSystemSnapshot(_input.sessionID, output.system.join("\n"))
          } catch (err) {
            log("ERROR in writeSystemSnapshot:", errorMessage(err))
          }
        }
      }
    },

    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
        variant?: string
      },
      output: { message: any; parts: any[] },
    ) => {
      try {
        log("chat.message FIRED — sessionID:", input.sessionID, "agent:", input.agent, "parts:", output.parts?.length)

        // Record the agent for ALL agent types (primary AND subagent) into the
        // sessionAgent bridge. opencode passes the agent explicitly on
        // `input.agent` (the subagent name from the Task tool); `output.message.agent`
        // is NOT reliably populated for subagents, which is why we read input.agent.
        const agent = input.agent?.toLowerCase()
        if (!agent) return
        log("chat.message — agent resolved:", agent)

        // Store in the bridge only — system.transform injects the persona into
        // the system prompt for every agent type. No message mutation.
        sessionAgent.set(input.sessionID, agent)
      } catch (err) {
        // `errorMessage` never throws — a hostile thrown value (a proxy with a
        // throwing `toString`, a cross-realm error, a revoked proxy) must not
        // turn the logger itself into the failure.
        log("ERROR in chat.message:", errorMessage(err))
      }
    },
  }
}

/**
 * Official OpenCode dual-generation default export.
 *
 * - v1 (1.19): calls `server()` — `PersonaInjectorPlugin`'s hook map.
 * - v2: decodes `{ id, setup }` from this object (the extra `server` key is
 *   ignored/stripped by the v2 module schema) and registers the session hooks.
 */
export default { id: "persona-injector", server: PersonaInjectorPlugin, setup }
