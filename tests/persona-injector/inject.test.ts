import { describe, expect, it } from "bun:test"
import { detectPrimaryAgent } from "../../persona-injector-server"

describe("detectPrimaryAgent", () => {
  it("returns 'coordinator' when the system contains 'Lead Coordinator Agent'", () => {
    const system = [
      "You are Warrior Monke, coordinator of THE JUNGLE.",
      "Lead Coordinator Agent assigns you tasks.",
    ]
    expect(detectPrimaryAgent(system)).toBe("coordinator")
  })

  it("returns 'plan' for the standard opencode preamble without coordinator", () => {
    const system = [
      "You are opencode, an interactive CLI tool for navigating codebases.",
      "Use the tools available to get the job done right.",
    ]
    expect(detectPrimaryAgent(system)).toBe("plan")
  })

  it("returns 'plan' for modern OpenCode capitalized preambles", () => {
    const system = [
      "You are OpenCode, the best coding agent on the planet.",
      "You are an interactive CLI tool that helps users with software engineering tasks.",
    ]
    expect(detectPrimaryAgent(system)).toBe("plan")
  })

  it("returns 'plan' for 'You are opencode, an interactive CLI agent'", () => {
    const system = [
      "You are opencode, an interactive CLI agent specializing in software engineering tasks.",
    ]
    expect(detectPrimaryAgent(system)).toBe("plan")
  })

  it("gives coordinator priority when both coordinator and opencode preamble are present", () => {
    const system = [
      "You are opencode, an interactive CLI tool.",
      "Instructions from: Lead Coordinator Agent",
    ]
    expect(detectPrimaryAgent(system)).toBe("coordinator")
  })

  it("returns undefined for a subagent/unknown system", () => {
    const system = ["You are a testing agent."]
    expect(detectPrimaryAgent(system)).toBeUndefined()
  })

  it("returns undefined for an empty system", () => {
    expect(detectPrimaryAgent([])).toBeUndefined()
  })

  it("returns undefined for a single empty string", () => {
    expect(detectPrimaryAgent([""])).toBeUndefined()
  })
})
