import { homedir } from "node:os"
import { readConfig } from "./persona-injector/config"
import { loadPersonas, resolvePersonaPrompt } from "./persona-injector/personas"
import type { PersonaMeta } from "./persona-injector/types"

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
 * - Subagents:    none of the above — return undefined so we don't inject
 *                 a primary-agent persona into subagent calls
 */
export function detectPrimaryAgent(system: string[]): string | undefined {
  const text = system.join("\n")
  if (text.includes("Lead Coordinator Agent")) return "coordinator"
  if (text.startsWith("You are opencode, an interactive CLI tool")) return "plan"
  return undefined
}

export const PersonaInjectorPlugin = async () => {
  const sessionAgent = new Map<string, string>()

  return {
    "experimental.chat.system.transform": async (
      _input: { sessionID?: string; model: any },
      output: { system: string[] },
    ) => {
      // 1. Resolve active persona from config (with legacy migration fallback)
      const config = await readConfig()
      const personaId = config.persona
      if (!personaId) return

      // 2. Skip title generator
      if (output.system.join("\n").includes("You are a title generator")) return

      // 3. Bail if MARKER already present (per-call duplicate guard)
      if (output.system.join("\n").includes(MARKER)) return

      // 4. Determine agent: sessionAgent bridge first, then content detection fallback
      let agent = _input.sessionID ? sessionAgent.get(_input.sessionID) : undefined
      if (!agent) {
        agent = detectPrimaryAgent(output.system)
      }
      if (!agent) return

      // 5. Look up persona prompt
      const prompts = await loadPersonaPrompts(personaId)
      const prompt = prompts.get(agent)
      if (!prompt) return

      // 6. Prepend MARKER + prompt to system[0], guarding against an empty array
      if (output.system.length === 0) {
        output.system.push(MARKER + "\n" + prompt)
      } else {
        output.system[0] = MARKER + "\n" + prompt + "\n\n" + output.system[0]
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
      // Record agent for ALL agent types (primary AND subagent)
      const agent = output.message?.agent?.toLowerCase()
      if (!agent) return

      // Store in sessionAgent bridge — NO message mutation, NO injectedSessions set
      sessionAgent.set(input.sessionID, agent)
    },
  }
}
