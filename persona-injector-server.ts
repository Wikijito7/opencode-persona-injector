import { homedir } from "node:os"
import { readConfig } from "./persona-injector/config"
import { loadPersonas, resolvePersonaPrompt } from "./persona-injector/personas"
import type { PersonaMeta } from "./persona-injector/types"
import { fileURLToPath } from "node:url"
import { createLog } from "./persona-injector/wlib/log"
import { writeSystemSnapshot, isTitleGenerator } from "./persona-injector/wlib/system"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const LOG_DIR = `${__dirname}logs`

const logger = createLog({ dir: LOG_DIR, fileName: "persona-injector.log" })
const log = logger.log

function snap(label: string, system: string[] | undefined) {
  const text = (system ?? []).join("\n")
  const preview = text.length > 400 ? text.slice(0, 400) + "…<TRUNCATED>" : text
  log(`SNAPSHOT[${label}] len=${text.length}:\n${preview}`)
}

const PERSONAS_DIR = `${homedir()}/.config/opencode/personas`
const MARKER = "Instructions from: persona-injector"

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

/**
 * Detect the primary agent name from the assembled system content.
 * Reliable even when `chat.message` fires after `system.transform`
 * (hook-ordering race on the first call of a session).
 *
 * - Coordinator: the system contains "Lead Coordinator Agent"
 * - Plan/Build:   the system starts with "You are opencode" (the standard
 *                 OpenCode preamble) but has NO "Lead Coordinator Agent"
 * - Subagents:    none of the above — return undefined; subagents are
 *                 resolved via the sessionAgent bridge, not content detection
 */
export function detectPrimaryAgent(system: string[]): string | undefined {
  const text = system.join("\n")
  if (text.includes("Lead Coordinator Agent")) return "coordinator"
  if (text.startsWith("You are opencode, an interactive CLI tool")) return "plan"
  return undefined
}

export const PersonaInjectorPlugin = async () => {
  const sessionAgent = new Map<string, string>()

  log("=== PersonaInjectorPlugin initialized ===")

  return {
    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: any },
      output: { system: string[] },
    ) => {
      const isTitleGen = isTitleGenerator(output.system)

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

        // 6. Prepend MARKER + prompt to system[0], guarding against an empty array
        if (output.system.length === 0) {
          output.system.push(MARKER + "\n" + prompt)
        } else {
          output.system[0] = MARKER + "\n" + prompt + "\n\n" + output.system[0]
        }
        log("system.transform — injected MARKER for:", agent)
        snap("system.transform AFTER", output.system)
      } catch (err) {
        log("ERROR in system.transform:", err instanceof Error ? err.message : String(err))
      } finally {
        // Persist the final system prompt (after injection, or the un-injected
        // truth when nothing was injected) so model-usage can read it.
        // Skipped for title-generator calls.
        if (!isTitleGen && _input.sessionID) {
          await writeSystemSnapshot(_input.sessionID, output.system.join("\n"))
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
        log("ERROR in chat.message:", err instanceof Error ? err.message : String(err))
      }
    },
  }
}
