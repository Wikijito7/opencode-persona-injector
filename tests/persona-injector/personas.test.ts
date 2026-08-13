import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  loadPersonas,
  resolvePersonaColor,
  resolvePersonaPrompt,
} from "@persona-injector/personas"

const createdDirs: string[] = []

/** Creates a fresh temp directory to host persona fixtures. */
function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "personas-test-"))
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("loadPersonas", () => {
  it("loads valid persona JSON files with id, displayName, and color", async () => {
    const dir = createTempDir()
    writeFileSync(
      join(dir, "hero.json"),
      JSON.stringify({
        displayName: "Hero",
        agents: { developer: { prompt: "Be a hero" } },
      }),
    )
    writeFileSync(
      join(dir, "mascot.json"),
      JSON.stringify({
        displayName: "Mascot",
        color: "#ff0000",
        agents: { testing: { prompt: "Test everything" } },
      }),
    )

    const personas = await loadPersonas(dir)
    expect(personas).toHaveLength(2)

    const hero = personas.find((p) => p.id === "hero")
    expect(hero?.displayName).toBe("Hero")
    expect(hero?.color).toBe("#22c55e")
    expect(hero?.agents.developer.prompt).toBe("Be a hero")

    const mascot = personas.find((p) => p.id === "mascot")
    expect(mascot?.displayName).toBe("Mascot")
    expect(mascot?.color).toBe("#ff0000")
    expect(mascot?.agents.testing.prompt).toBe("Test everything")
  })

  it("defaults color to #22c55e and enabled to true when omitted", async () => {
    const dir = createTempDir()
    writeFileSync(
      join(dir, "minimal.json"),
      JSON.stringify({
        displayName: "Minimal",
        agents: { reviewer: { prompt: "Roast it" } },
      }),
    )

    const personas = await loadPersonas(dir)
    expect(personas).toHaveLength(1)
    const persona = personas[0]
    expect(persona.color).toBe("#22c55e")
    expect(persona.agents.reviewer.enabled).toBe(true)
  })

  it("skips invalid JSON files while loading other valid personas", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const dir = createTempDir()
      writeFileSync(join(dir, "broken.json"), "{ not valid json !!!")
      writeFileSync(
        join(dir, "good.json"),
        JSON.stringify({
          displayName: "Good",
          agents: { qa: { prompt: "Verify" } },
        }),
      )

      const personas = await loadPersonas(dir)
      expect(personas).toHaveLength(1)
      expect(personas[0].id).toBe("good")
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("skips valid JSON with an invalid shape (missing displayName)", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {})
    try {
      const dir = createTempDir()
      writeFileSync(
        join(dir, "shapeless.json"),
        JSON.stringify({ agents: { developer: { prompt: "hi" } } }),
      )
      writeFileSync(
        join(dir, "ok.json"),
        JSON.stringify({
          displayName: "OK",
          agents: { developer: { prompt: "hi" } },
        }),
      )

      const personas = await loadPersonas(dir)
      expect(personas).toHaveLength(1)
      expect(personas[0].id).toBe("ok")
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("sorts loaded personas alphabetically by id", async () => {
    const dir = createTempDir()
    const persona = (name: string) => ({
      displayName: name,
      agents: { developer: { prompt: name } },
    })
    writeFileSync(join(dir, "b.json"), JSON.stringify(persona("B")))
    writeFileSync(join(dir, "a.json"), JSON.stringify(persona("A")))
    writeFileSync(join(dir, "c.json"), JSON.stringify(persona("C")))

    const personas = await loadPersonas(dir)
    expect(personas.map((p) => p.id)).toEqual(["a", "b", "c"])
  })

  it("returns an empty array when the directory does not exist", async () => {
    const missing = join(tmpdir(), `personas-missing-${Date.now()}`)
    const personas = await loadPersonas(missing)
    expect(personas).toEqual([])
  })

  it("skips non-JSON files and loads only .json files", async () => {
    const dir = createTempDir()
    writeFileSync(join(dir, "notes.txt"), "just some notes")
    writeFileSync(
      join(dir, "real.json"),
      JSON.stringify({
        displayName: "Real",
        agents: { developer: { prompt: "hi" } },
      }),
    )

    const personas = await loadPersonas(dir)
    expect(personas).toHaveLength(1)
    expect(personas[0].id).toBe("real")
  })

  it("loads template personas (id prefixed with _) but keeps authored enabled field", async () => {
    const dir = createTempDir()
    writeFileSync(
      join(dir, "_template.json"),
      JSON.stringify({
        displayName: "Template",
        agents: { developer: { prompt: "Template prompt", enabled: false } },
      }),
    )

    const personas = await loadPersonas(dir)
    expect(personas).toHaveLength(1)
    const template = personas[0]
    expect(template.id).toBe("_template")
    // Template personas keep their `enabled` field untouched.
    expect(template.agents.developer.enabled).toBe(false)
    expect(resolvePersonaPrompt(template, "developer")).toBeNull()
  })

  it("loads a persona whose agent is explicitly disabled and resolves prompt to null", async () => {
    const dir = createTempDir()
    writeFileSync(
      join(dir, "disabled.json"),
      JSON.stringify({
        displayName: "Disabled",
        agents: { developer: { prompt: "Secret", enabled: false } },
      }),
    )

    const personas = await loadPersonas(dir)
    expect(personas).toHaveLength(1)
    expect(resolvePersonaPrompt(personas[0], "developer")).toBeNull()
  })
})

describe("resolvePersonaPrompt", () => {
  it("returns the prompt when the agent is listed and enabled", () => {
    const persona = {
      id: "hero",
      displayName: "Hero",
      color: "#22c55e",
      agents: { developer: { prompt: "Be a hero", enabled: true } },
    }
    expect(resolvePersonaPrompt(persona, "developer")).toBe("Be a hero")
  })

  it("returns null when the agent is not listed", () => {
    const persona = {
      id: "hero",
      displayName: "Hero",
      color: "#22c55e",
      agents: { developer: { prompt: "Be a hero", enabled: true } },
    }
    expect(resolvePersonaPrompt(persona, "qa")).toBeNull()
  })

  it("returns null for template personas (id starts with _)", () => {
    const persona = {
      id: "_template",
      displayName: "Template",
      color: "#22c55e",
      agents: { developer: { prompt: "Template prompt", enabled: true } },
    }
    expect(resolvePersonaPrompt(persona, "developer")).toBeNull()
  })

  it("returns null when the agent is explicitly disabled", () => {
    const persona = {
      id: "hero",
      displayName: "Hero",
      color: "#22c55e",
      agents: { developer: { prompt: "Be a hero", enabled: false } },
    }
    expect(resolvePersonaPrompt(persona, "developer")).toBeNull()
  })

  it("trims trailing whitespace from the prompt", () => {
    const persona = {
      id: "hero",
      displayName: "Hero",
      color: "#22c55e",
      agents: { developer: { prompt: "Be a hero\n\n  ", enabled: true } },
    }
    expect(resolvePersonaPrompt(persona, "developer")).toBe("Be a hero")
  })
})

describe("resolvePersonaColor", () => {
  it("returns the persona's color", () => {
    const persona = {
      id: "hero",
      displayName: "Hero",
      color: "#ffaa00",
      agents: { developer: { prompt: "Be a hero", enabled: true } },
    }
    expect(resolvePersonaColor(persona)).toBe("#ffaa00")
  })

  it("returns the defaulted color when persona was loaded without one", async () => {
    const dir = createTempDir()
    writeFileSync(
      join(dir, "hero.json"),
      JSON.stringify({
        displayName: "Hero",
        agents: { developer: { prompt: "Be a hero" } },
      }),
    )

    const personas = await loadPersonas(dir)
    expect(resolvePersonaColor(personas[0])).toBe("#22c55e")
  })
})
