import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type {
  PersonaAgentConfig,
  PersonaDefinition,
  PersonaMeta,
} from "./types"

/**
 * Default color applied when a persona does not define one.
 */
const DEFAULT_COLOR = "#22c55e"

/**
 * Type guard that validates the raw shape of a parsed persona object.
 *
 * A valid persona must have a string `displayName` and an object `agents`
 * where every entry carries a string `prompt`.
 */
function isValidPersona(raw: unknown): raw is PersonaDefinition {
  if (typeof raw !== "object" || raw === null) return false

  const obj = raw as Record<string, unknown>
  if (typeof obj.displayName !== "string") return false
  if (typeof obj.agents !== "object" || obj.agents === null) return false

  for (const agent of Object.values(obj.agents as Record<string, unknown>)) {
    if (typeof agent !== "object" || agent === null) return false
    if (typeof (agent as Record<string, unknown>).prompt !== "string") return false
  }

  return true
}

/**
 * Loads every persona definition from the `*.json` files in `dir`.
 *
 * - Skips non-JSON files, invalid JSON, and malformed shapes (logging a warning).
 * - Resolves the `color` default and the per-agent `enabled` default.
 * - Template personas (`_` prefixed ids) keep their `enabled` field untouched,
 *   since they are auto-disabled by convention.
 * - Returns `[]` if the directory does not exist.
 */
export async function loadPersonas(dir: string): Promise<PersonaMeta[]> {
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    // Directory does not exist (or is unreadable) → treat as empty.
    return []
  }

  const personas: PersonaMeta[] = []

  for (const filename of files) {
    if (!filename.endsWith(".json")) continue

    const id = filename.slice(0, -".json".length)
    const isTemplate = id.startsWith("_")

    let raw: unknown
    try {
      const text = await Bun.file(join(dir, filename)).text()
      raw = JSON.parse(text)
    } catch (err) {
      console.warn(`[personas] Skipping invalid JSON file "${filename}":`, err)
      continue
    }

    if (!isValidPersona(raw)) {
      console.warn(
        `[personas] Skipping "${filename}": missing or invalid "displayName" or "agents".`,
      )
      continue
    }

    const definition = raw as PersonaDefinition
    const agents: Record<string, PersonaAgentConfig> = {}

    for (const [agentName, agent] of Object.entries(definition.agents)) {
      if (isTemplate) {
        // Auto-disabled by convention; leave `enabled` exactly as authored.
        agents[agentName] = { ...agent }
      } else {
        agents[agentName] = { ...agent, enabled: agent.enabled ?? true }
      }
    }

    personas.push({
      id,
      displayName: definition.displayName,
      color: definition.color ?? DEFAULT_COLOR,
      agents,
    })
  }

  personas.sort((a, b) => a.id.localeCompare(b.id))
  return personas
}

/**
 * Resolves the prompt for a specific agent within a persona.
 *
 * Returns `null` when the agent is not listed, when it is disabled, or when
 * the persona is a template (auto-disabled by convention).
 */
export function resolvePersonaPrompt(
  personaMeta: PersonaMeta,
  agent: string,
): string | null {
  const config = personaMeta.agents[agent]
  if (!config) return null

  // Template personas are auto-disabled regardless of their `enabled` field.
  if (personaMeta.id.startsWith("_")) return null
  if (config.enabled === false) return null

  return config.prompt
}

/**
 * Returns the resolved color of a persona (already defaulted at load time).
 */
export function resolvePersonaColor(personaMeta: PersonaMeta): string {
  return personaMeta.color
}
