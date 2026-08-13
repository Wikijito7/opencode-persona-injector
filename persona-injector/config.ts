import { homedir } from "node:os"
import type { PersonaInjectorConfig } from "./types"

/** Persona used when migrating from the legacy jungle-mode config. */
export const LEGACY_PERSONA_ID = "jungle-mode"

function configPath(): string {
  return `${homedir()}/.config/opencode/persona-injector.json`
}

function legacyConfigPath(): string {
  return `${homedir()}/.config/opencode/jungle-mode.json`
}

/** Returns the `persona` value from an already-parsed config object, or null when the shape is invalid. */
function extractPersona(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null
  const persona = (value as Record<string, unknown>).persona
  if (persona === null || persona === undefined) return null
  if (typeof persona !== "string") return null
  return persona
}

/** Reads the legacy `jungle-mode.json` and maps its `enabled` flag to a persona id. Read-only. */
async function migrateFromLegacy(): Promise<PersonaInjectorConfig> {
  const path = legacyConfigPath()
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return { persona: null }

    const raw = await file.text()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.enabled === true) return { persona: LEGACY_PERSONA_ID }
    return { persona: null }
  } catch {
    // Any error reading/parsing the legacy file falls back to disabled.
    return { persona: null }
  }
}

export async function readConfig(): Promise<PersonaInjectorConfig> {
  const path = configPath()
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return migrateFromLegacy()

    const raw = await file.text()
    const parsed: unknown = JSON.parse(raw)
    const persona = extractPersona(parsed)

    // A valid new config (persona string or explicit null) wins outright.
    if (persona !== null) return { persona }
    // New file exists and parsed but has no persona field → treat as disabled,
    // but only after confirming the shape parsed as an object.
    if (typeof parsed === "object" && parsed !== null) return { persona: null }

    // Otherwise fall back to legacy migration.
    return migrateFromLegacy()
  } catch {
    // Any error reading/parsing the new file falls back to legacy migration,
    // which itself safely defaults to disabled on error.
    return migrateFromLegacy()
  }
}

export async function writeConfig(config: PersonaInjectorConfig): Promise<void> {
  await Bun.write(configPath(), JSON.stringify(config))
}
