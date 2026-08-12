import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { homedir } from "node:os"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import {
  LEGACY_PERSONA_ID,
  readConfig,
  writeConfig,
} from "@persona-injector/config"

/**
 * The `@persona-injector/config` module resolves its config paths from the real
 * `homedir()` (`~/.config/opencode/persona-injector.json` and
 * `~/.config/opencode/jungle-mode.json`). Because `homedir()` cannot be mocked
 * without module-level mocking (which the module under test does not support
 * cleanly), these tests operate on the real paths directly.
 *
 * To avoid clobbering a user's actual config, we snapshot the real files once
 * before the suite runs, isolate every test with a clean slate, and restore the
 * originals afterwards.
 */

const CONFIG_DIR = `${homedir()}/.config/opencode`
const NEW_PATH = `${CONFIG_DIR}/persona-injector.json`
const LEGACY_PATH = `${CONFIG_DIR}/jungle-mode.json`

/** Reads a file's contents, returning null when it does not exist or can't be read. */
async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8")
  } catch {
    return null
  }
}

/** Restores a file to its snapshot, removing it entirely when there was no original. */
async function restore(path: string, snapshot: string | null): Promise<void> {
  if (snapshot === null) {
    await rm(path, { force: true })
  } else {
    await writeFile(path, snapshot)
  }
}

let newSnapshot: string | null = null
let legacySnapshot: string | null = null

beforeAll(async () => {
  await mkdir(CONFIG_DIR, { recursive: true })
  newSnapshot = await readOrNull(NEW_PATH)
  legacySnapshot = await readOrNull(LEGACY_PATH)
})

afterAll(async () => {
  await restore(NEW_PATH, newSnapshot)
  await restore(LEGACY_PATH, legacySnapshot)
})

/** Resets both config files to a clean slate before each test. */
async function resetFiles(): Promise<void> {
  await rm(NEW_PATH, { force: true })
  await rm(LEGACY_PATH, { force: true })
}

/** Writes a JSON payload to the new `persona-injector.json`. */
async function writeNewConfig(value: unknown): Promise<void> {
  await writeFile(NEW_PATH, JSON.stringify(value))
}

/** Writes a JSON payload to the legacy `jungle-mode.json`. */
async function writeLegacyConfig(value: unknown): Promise<void> {
  await writeFile(LEGACY_PATH, JSON.stringify(value))
}

describe("readConfig", () => {
  it("returns { persona: null } when neither new nor legacy config exists", async () => {
    await resetFiles()
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("returns the persona for a valid new config", async () => {
    await resetFiles()
    await writeNewConfig({ persona: "my-persona" })
    expect(await readConfig()).toEqual({ persona: "my-persona" })
  })

  it("returns { persona: null } when the new config explicitly sets null", async () => {
    await resetFiles()
    await writeNewConfig({ persona: null })
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("returns { persona: null } when the new config omits the persona field", async () => {
    await resetFiles()
    await writeNewConfig({})
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("falls back to null when the new config has invalid JSON and no legacy config", async () => {
    await resetFiles()
    await writeFile(NEW_PATH, "{ not valid json !!!")
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("falls back to the legacy persona when the new config has invalid JSON but legacy is enabled", async () => {
    await resetFiles()
    await writeFile(NEW_PATH, "{ not valid json !!!")
    await writeLegacyConfig({ enabled: true })
    expect(await readConfig()).toEqual({ persona: LEGACY_PERSONA_ID })
  })

  it("migrates from legacy config when enabled is true and no new config exists", async () => {
    await resetFiles()
    await writeLegacyConfig({ enabled: true })
    expect(await readConfig()).toEqual({ persona: LEGACY_PERSONA_ID })
  })

  it("returns { persona: null } when legacy config exists with enabled false", async () => {
    await resetFiles()
    await writeLegacyConfig({ enabled: false })
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("returns { persona: null } when legacy config exists without an enabled field", async () => {
    await resetFiles()
    await writeLegacyConfig({})
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("returns { persona: null } when legacy config has invalid JSON", async () => {
    await resetFiles()
    await writeFile(LEGACY_PATH, "{ not valid json !!!")
    expect(await readConfig()).toEqual({ persona: null })
  })

  it("prefers the new config over legacy when both files exist", async () => {
    await resetFiles()
    await writeNewConfig({ persona: "custom" })
    await writeLegacyConfig({ enabled: true })
    expect(await readConfig()).toEqual({ persona: "custom" })
  })

  it("treats a non-string persona value as disabled", async () => {
    await resetFiles()
    await writeNewConfig({ persona: 123 })
    expect(await readConfig()).toEqual({ persona: null })
  })
})

describe("writeConfig", () => {
  it("writes and reads back a configured persona", async () => {
    await resetFiles()
    await writeConfig({ persona: "test" })
    expect(await readConfig()).toEqual({ persona: "test" })
  })

  it("writes and reads back a null persona (disabled)", async () => {
    await resetFiles()
    await writeConfig({ persona: null })
    expect(await readConfig()).toEqual({ persona: null })
  })
})
