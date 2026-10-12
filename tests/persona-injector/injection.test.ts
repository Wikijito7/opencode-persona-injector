import { describe, expect, it } from "bun:test"
import {
  injectPersona,
  PERSONA_MARKER,
  type PersonaInjectionDeps,
  type PersonaInjectionEvent,
} from "@persona-injector/injection"

/**
 * Pure unit tests for the injectable `injectPersona` pipeline.
 *
 * Every side effect (config read, persona prompt load, snapshot write, log) is
 * injected, so no host packages or filesystem are involved. The unit under test
 * mutates `event.system` in place, mirroring the v2 `session.hook("context")`
 * contract.
 */

const MARKER = PERSONA_MARKER

interface SnapshotCall {
  sessionID: string
  rawText: string
}

/**
 * Builds a fully-injected deps object plus a recorder for snapshot writes.
 *
 * Defaults: persona "hero" enabled, a single `developer` prompt, no title
 * generation, and a no-op logger.
 */
function makeDeps(
  overrides: Partial<PersonaInjectionDeps> = {},
  prompts: Record<string, string> = { developer: "BE A HERO" },
  config: string | null = "hero",
): { deps: PersonaInjectionDeps; snapshotCalls: SnapshotCall[] } {
  const snapshotCalls: SnapshotCall[] = []
  const deps: PersonaInjectionDeps = {
    readConfig: async () => ({ persona: config }),
    loadPrompts: async () => new Map(Object.entries(prompts)),
    writeSnapshot: async (sessionID, rawText) => {
      snapshotCalls.push({ sessionID, rawText })
    },
    isTitleGenerator: () => false,
    log: () => {},
    ...overrides,
  }
  return { deps, snapshotCalls }
}

/** Builds a mutable context event, defaulting to a directly-addressed agent. */
function makeEvent(overrides: Partial<PersonaInjectionEvent> = {}): PersonaInjectionEvent {
  return {
    sessionID: "session-1",
    agent: "developer",
    system: [{ type: "text", text: "BASE SYSTEM" }],
    ...overrides,
  }
}

describe("PERSONA_MARKER", () => {
  it("is the canonical marker string the guard and snapshot rely on", () => {
    expect(PERSONA_MARKER).toBe("Instructions from: persona-injector")
  })
})

describe("injectPersona — direct agent resolution", () => {
  it("prepends MARKER + prompt + separator to the first system part", async () => {
    const { deps } = makeDeps()
    const event = makeEvent()

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system).toHaveLength(1)
    expect(event.system[0].text).toBe(`${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM`)
  })

  it("lowercases the event agent id before looking up the prompt", async () => {
    const { deps } = makeDeps()
    const event = makeEvent({ agent: "DEVELOPER" })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toContain("BE A HERO")
  })

  it("prefers event.agent over content-detection when both could resolve", async () => {
    const { deps } = makeDeps({}, { developer: "DEV PROMPT", plan: "PLAN PROMPT" })
    const event = makeEvent({
      agent: "developer",
      system: [{ type: "text", text: "You are opencode, an interactive CLI tool." }],
    })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toContain("DEV PROMPT")
    expect(event.system[0].text).not.toContain("PLAN PROMPT")
  })

  it("leaves every system part after the first untouched", async () => {
    const { deps } = makeDeps()
    const event = makeEvent({
      system: [
        { type: "text", text: "FIRST" },
        { type: "text", text: "SECOND" },
      ],
    })

    await injectPersona(event, deps)

    expect(event.system).toHaveLength(2)
    expect(event.system[0].text).toBe(`${MARKER}\nBE A HERO\n\n---\n\nFIRST`)
    expect(event.system[1].text).toBe("SECOND")
  })
})

describe("injectPersona — content fallback", () => {
  it("falls back to coordinator detection when the agent id has no prompt", async () => {
    const { deps } = makeDeps({}, { coordinator: "COORD PROMPT" })
    const event = makeEvent({
      agent: undefined,
      system: [{ type: "text", text: "Lead Coordinator Agent assigns you tasks." }],
    })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toContain("COORD PROMPT")
  })

  it("falls back to plan detection for a generic primary agent", async () => {
    const { deps } = makeDeps({}, { plan: "PLAN PROMPT" })
    const event = makeEvent({
      agent: "build",
      system: [{ type: "text", text: "You are opencode, an interactive CLI agent." }],
    })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toContain("PLAN PROMPT")
  })

  it("returns false when neither the agent id nor the content resolves", async () => {
    const { deps } = makeDeps({}, { developer: "BE A HERO" })
    const event = makeEvent({
      agent: "build",
      system: [{ type: "text", text: "You are a testing agent." }],
    })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(false)
    expect(event.system[0].text).toBe("You are a testing agent.")
  })

  it("returns false for an unknown agent id with no fallback signal", async () => {
    const { deps } = makeDeps({}, { developer: "BE A HERO" })
    const event = makeEvent({ agent: "builder", system: [{ type: "text", text: "plain" }] })

    expect(await injectPersona(event, deps)).toBe(false)
    expect(event.system[0].text).toBe("plain")
  })

  it("does not reroute an unknown subagent id to plan even when the content matches", async () => {
    // The system carries the standard opencode preamble (detectPrimaryAgent →
    // "plan"), but "search" is a subagent id with no prompt of its own: its
    // sole authority is its own id, so the primary content fallback must not run.
    const { deps } = makeDeps({}, { plan: "PLAN PROMPT" })
    const event = makeEvent({
      agent: "search",
      system: [{ type: "text", text: "You are opencode, an interactive CLI agent." }],
    })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(false)
    expect(event.system[0].text).toBe("You are opencode, an interactive CLI agent.")
  })

  it("does not reroute an unknown subagent id to coordinator even when the content matches", async () => {
    const { deps } = makeDeps({}, { coordinator: "COORD PROMPT" })
    const event = makeEvent({
      agent: "general",
      system: [{ type: "text", text: "Report to the Lead Coordinator Agent." }],
    })

    expect(await injectPersona(event, deps)).toBe(false)
    expect(event.system[0].text).toBe("Report to the Lead Coordinator Agent.")
  })

  it("keeps the known primary 'build' fallback for a missing persona entry", async () => {
    // "build" is a declared primary id with no prompt of its own; the content
    // fallback (plan) is the intended resolution — this must remain intact.
    const { deps } = makeDeps({}, { plan: "PLAN PROMPT" })
    const event = makeEvent({
      agent: "BUILD",
      system: [{ type: "text", text: "You are opencode, an interactive CLI agent." }],
    })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toContain("PLAN PROMPT")
  })
})

describe("injectPersona — guards", () => {
  it("skips injection entirely when the persona is disabled", async () => {
    const { deps } = makeDeps({}, { developer: "BE A HERO" }, null)
    const event = makeEvent()

    expect(await injectPersona(event, deps)).toBe(false)
    expect(event.system[0].text).toBe("BASE SYSTEM")
  })

  it("skips when the marker is already present (duplicate guard)", async () => {
    const { deps } = makeDeps()
    const existing = `${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM`
    const event = makeEvent({ system: [{ type: "text", text: existing }] })

    expect(await injectPersona(event, deps)).toBe(false)
    expect(event.system[0].text).toBe(existing)
  })

  it("skips title-generator calls via the injected predicate", async () => {
    const { deps, snapshotCalls } = makeDeps({ isTitleGenerator: () => true })
    const event = makeEvent()

    expect(await injectPersona(event, deps)).toBe(false)
    expect(event.system[0].text).toBe("BASE SYSTEM")
    expect(snapshotCalls).toEqual([])
  })

  it("skips title-generator calls via the default wlib predicate", async () => {
    const { deps, snapshotCalls } = makeDeps({ isTitleGenerator: undefined })
    const event = makeEvent({
      system: [{ type: "text", text: "You are a title generator. Summarize the conversation." }],
    })

    expect(await injectPersona(event, deps)).toBe(false)
    expect(event.system[0].text).toContain("title generator")
    expect(snapshotCalls).toEqual([])
  })
})

describe("injectPersona — empty system handling", () => {
  it("pushes a single marker+prompt part (no trailing separator) for an empty system", async () => {
    const { deps } = makeDeps()
    const event = makeEvent({ system: [] })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system).toHaveLength(1)
    expect(event.system[0]).toEqual({ type: "text", text: `${MARKER}\nBE A HERO\n\n---` })
  })
})

describe("injectPersona — snapshot behavior", () => {
  it("persists the post-injection system text keyed by sessionID", async () => {
    const { deps, snapshotCalls } = makeDeps()
    const event = makeEvent({ sessionID: "session-42" })

    await injectPersona(event, deps)

    expect(snapshotCalls).toEqual([
      {
        sessionID: "session-42",
        rawText: `${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM`,
      },
    ])
  })

  it("persists the un-injected truth when the persona is disabled", async () => {
    const { deps, snapshotCalls } = makeDeps({}, { developer: "BE A HERO" }, null)
    const event = makeEvent({ sessionID: "session-7" })

    await injectPersona(event, deps)

    expect(snapshotCalls).toEqual([{ sessionID: "session-7", rawText: "BASE SYSTEM" }])
  })

  it("does not snapshot when the event has no sessionID", async () => {
    const { deps, snapshotCalls } = makeDeps()
    const event = makeEvent({ sessionID: undefined })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(snapshotCalls).toEqual([])
  })

  it("does not throw and still injects when writeSnapshot is omitted", async () => {
    const { deps } = makeDeps({ writeSnapshot: undefined })
    const event = makeEvent()

    expect(await injectPersona(event, deps)).toBe(true)
    expect(event.system[0].text).toContain("BE A HERO")
  })

  it("still snapshots the un-injected truth when readConfig rejects", async () => {
    const { deps, snapshotCalls } = makeDeps({
      readConfig: async () => {
        throw new Error("config boom")
      },
    })
    const event = makeEvent({ sessionID: "session-err" })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(false)
    expect(event.system[0].text).toBe("BASE SYSTEM")
    expect(snapshotCalls).toEqual([{ sessionID: "session-err", rawText: "BASE SYSTEM" }])
  })

  it("still injects but does not write when persistSnapshot is false", async () => {
    // compaction/generate requests (handlerFor(false)) must receive the persona
    // yet never overwrite the shared sidecar.
    const { deps, snapshotCalls } = makeDeps({ persistSnapshot: false })
    const event = makeEvent({ sessionID: "session-compaction" })

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toBe(`${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM`)
    expect(snapshotCalls).toEqual([])
  })

  it("persists by default when persistSnapshot is omitted (single-caller contract)", async () => {
    const { deps, snapshotCalls } = makeDeps()
    const event = makeEvent({ sessionID: "session-default" })

    await injectPersona(event, deps)

    expect(snapshotCalls).toEqual([
      { sessionID: "session-default", rawText: `${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM` },
    ])
  })
})

describe("injectPersona — resilient injected side effects", () => {
  it("does not reject and still injects when isTitleGenerator throws", async () => {
    const { deps } = makeDeps({
      isTitleGenerator: () => {
        throw new Error("predicate boom")
      },
    })
    const event = makeEvent()

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toBe(`${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM`)
  })

  it("does not reject when writeSnapshot rejects", async () => {
    const { deps } = makeDeps({
      writeSnapshot: async () => {
        throw new Error("write boom")
      },
    })
    const event = makeEvent()

    const injected = await injectPersona(event, deps)

    expect(injected).toBe(true)
    expect(event.system[0].text).toBe(`${MARKER}\nBE A HERO\n\n---\n\nBASE SYSTEM`)
  })

  it("attempts the snapshot exactly once even when the writer rejects", async () => {
    // A broken writer must not corrupt the injection result even though the
    // snapshot itself is lost.
    let calls = 0
    const { deps } = makeDeps({
      writeSnapshot: async () => {
        calls += 1
        throw new Error("write boom")
      },
    })
    const event = makeEvent({ sessionID: "session-flaky" })

    expect(await injectPersona(event, deps)).toBe(true)
    expect(calls).toBe(1)
    expect(event.system[0].text).toContain("BE A HERO")
  })
})
