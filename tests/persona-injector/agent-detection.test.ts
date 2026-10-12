import { describe, expect, it } from "bun:test"
import {
  detectPrimaryAgent,
  isPrimaryAgentId,
  PRIMARY_AGENT_IDS,
} from "@persona-injector/agent-detection"
import { detectPrimaryAgent as detectPrimaryAgentViaServer } from "../../persona-injector-server"

/**
 * Direct tests for the shared `persona-injector/agent-detection.ts` module.
 *
 * `tests/persona-injector/inject.test.ts` exercises the same predicate through
 * the v1 server re-export; this suite pins the shared module itself (including
 * the boundary cases the regex broadening introduced) and asserts the v1
 * re-export is the exact same function object.
 */
describe("detectPrimaryAgent (shared agent-detection module)", () => {
  it("is the same function object the v1 server re-exports", () => {
    expect(detectPrimaryAgentViaServer).toBe(detectPrimaryAgent)
  })

  it("returns 'coordinator' when 'Lead Coordinator Agent' appears in any part", () => {
    expect(
      detectPrimaryAgent(["You are a subagent.", "Report to the Lead Coordinator Agent."]),
    ).toBe("coordinator")
  })

  it("gives the coordinator marker priority over an opencode preamble", () => {
    expect(
      detectPrimaryAgent([
        "You are opencode, an interactive CLI tool.",
        "The Lead Coordinator Agent owns the plan.",
      ]),
    ).toBe("coordinator")
  })

  it("returns 'plan' for the lowercase opencode preamble", () => {
    expect(
      detectPrimaryAgent(["You are opencode, an interactive CLI tool for coding."]),
    ).toBe("plan")
  })

  it("returns 'plan' for the capitalized OpenCode preamble", () => {
    expect(
      detectPrimaryAgent(["You are OpenCode, the best coding agent on the planet."]),
    ).toBe("plan")
  })

  it("returns 'plan' for an all-caps OPENCODE preamble (case-insensitive)", () => {
    expect(detectPrimaryAgent(["You are OPENCODE, an agent."])).toBe("plan")
  })

  it("returns 'plan' when the preamble is preceded by leading whitespace", () => {
    expect(detectPrimaryAgent(["   \n  You are opencode, an interactive CLI tool."])).toBe(
      "plan",
    )
  })

  it("returns undefined when the preamble is not at the start of the joined text", () => {
    expect(
      detectPrimaryAgent(["Some host preamble.", "You are opencode, an interactive CLI tool."]),
    ).toBeUndefined()
  })

  it("returns undefined when the preamble is split across parts", () => {
    // Joined as "You are\nopencode" — the anchored `^You are opencode` no longer matches.
    expect(detectPrimaryAgent(["You are", "opencode, an interactive CLI tool."])).toBeUndefined()
  })

  it("returns undefined for a subagent system", () => {
    expect(detectPrimaryAgent(["You are a testing agent."])).toBeUndefined()
  })

  it("returns undefined for an empty system array", () => {
    expect(detectPrimaryAgent([])).toBeUndefined()
  })

  it("returns undefined for a single empty string", () => {
    expect(detectPrimaryAgent([""])).toBeUndefined()
  })
})

describe("PRIMARY_AGENT_IDS", () => {
  it("enumerates exactly the agent-loop primary ids", () => {
    expect(PRIMARY_AGENT_IDS).toEqual(["coordinator", "plan", "build"])
  })
})

describe("isPrimaryAgentId", () => {
  it("returns true for every enumerated primary id", () => {
    for (const id of PRIMARY_AGENT_IDS) {
      expect(isPrimaryAgentId(id)).toBe(true)
    }
  })

  it("matches primary ids case-insensitively", () => {
    expect(isPrimaryAgentId("BUILD")).toBe(true)
    expect(isPrimaryAgentId("Plan")).toBe(true)
    expect(isPrimaryAgentId("CoOrDiNaToR")).toBe(true)
  })

  it("returns false for a known subagent id (never a primary)", () => {
    expect(isPrimaryAgentId("search")).toBe(false)
    expect(isPrimaryAgentId("explore")).toBe(false)
    expect(isPrimaryAgentId("general")).toBe(false)
  })

  it("returns false for an unknown id that merely resembles a primary", () => {
    expect(isPrimaryAgentId("builder")).toBe(false)
    expect(isPrimaryAgentId("planning")).toBe(false)
  })

  it("returns false for the empty string", () => {
    expect(isPrimaryAgentId("")).toBe(false)
  })
})
