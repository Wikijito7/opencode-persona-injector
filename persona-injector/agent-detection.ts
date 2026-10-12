/**
 * Pure agent-detection helpers shared by the v1 and v2 server entrypoints.
 *
 * No host imports — fully unit-testable. The v2 `session.hook("context")`
 * event carries an authoritative `agent` id, so content detection is only
 * used as a fallback when the resolved id has no persona entry (e.g. a
 * generic primary agent whose system carries the opencode preamble).
 */

/**
 * Agent ids OpenCode drives as primary (agent-loop) agents. Persona packs use
 * these ids, so a *generic* primary whose persona entry is missing — e.g.
 * `"build"` when the pack only defines `"plan"` — may still be resolved through
 * content detection.
 *
 * Any OTHER provided id is a subagent: it must be resolved by its own id alone
 * and must never be re-routed to a primary persona by sniffing the system
 * content. This mirrors the original v1 contract, which enumerated exactly
 * these ids before using the bridge value as an authoritative agent.
 */
export const PRIMARY_AGENT_IDS: readonly string[] = ["coordinator", "plan", "build"]

/**
 * Whether the primary-agent content-detection fallback may run for `agentId`.
 *
 * Callers decide the "no id at all" case separately (`!agentId`), because an
 * absent id is the strongest signal that the request is a generic primary.
 */
export function isPrimaryAgentId(agentId: string): boolean {
  return PRIMARY_AGENT_IDS.includes(agentId.toLowerCase())
}

/**
 * Detect the primary agent name from the assembled system content.
 *
 * - Coordinator: the system contains "Lead Coordinator Agent"
 * - Plan/Build:   the system starts with "You are opencode" (the standard
 *                 OpenCode preamble) but has NO "Lead Coordinator Agent"
 * - Subagents:    none of the above — return undefined; subagents are
 *                 resolved through their own agent id, not content detection
 */
export function detectPrimaryAgent(system: string[]): string | undefined {
  const text = system.join("\n")
  if (text.includes("Lead Coordinator Agent")) return "coordinator"
  if (/^You are (OpenCode|opencode)\b/i.test(text.trimStart())) return "plan"
  return undefined
}
