/**
 * Persona Injector — OpenCode 2.x server entrypoint (PRODUCTION).
 *
 * OpenCode v2 (`@opencode/plugin`) replaces the v1 `experimental.chat.system.transform`
 * / `chat.message` hooks with a single **session context hook**. The context event
 * is mutable immediately before provider dispatch and carries:
 *
 * - `event.system`  — the system prompt as an array of `{ type: "text", text }` parts
 * - `event.agent`   — the authoritative agent id (primary AND subagent sessions)
 * - `event.sessionID`
 * - `event.messages`, `event.model`, `event.tools`
 *
 * This module is a thin host adapter: it registers the pure, injectable
 * `injectPersona` pipeline (see `./injection`) on `context`, `compaction` and
 * `generate` — exactly the agent-loop request kinds. It deliberately does NOT
 * register the separate `title` hook, so title-generation calls never receive a
 * persona.
 *
 * Request kinds are distinguished at registration: only the primary `context`
 * request is allowed to persist the shared system-snapshot sidecar that
 * `model-usage` reads; `compaction`/`generate` inject a persona but never
 * overwrite that snapshot with their auxiliary system prompts.
 *
 * Do NOT import a v1 host API here — the v1 entrypoint lives in
 * `persona-injector-server.ts` and uses the deprecated `createV1Host` adapter.
 */
import { Plugin } from "@opencode/plugin"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { readConfig } from "./config"
import { loadPersonas, resolvePersonaPrompt } from "./personas"
import type { PersonaMeta } from "./types"
import { createLog } from "./wlib/src/core/log"
import { writeSystemSnapshot } from "./wlib/src/core/system"
import { injectPersona, type PersonaInjectionEvent } from "./injection"

const LOG_DIR = fileURLToPath(new URL("./logs", import.meta.url))
const logger = createLog({ dir: LOG_DIR, fileName: "persona-injector.log" })
const log = logger.log

const PERSONAS_DIR = `${homedir()}/.config/opencode/personas`

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

export default Plugin.define({
  id: "persona-injector",
  async setup(ctx) {
    const deps = {
      readConfig,
      loadPrompts: loadPersonaPrompts,
      writeSnapshot: writeSystemSnapshot,
      log,
    }

    // The hook callback must return void; `injectPersona` returns a boolean for
    // testability, so swallow it here.
    //
    // Only the primary agent-loop `context` request owns the shared sidecar
    // snapshot that `model-usage` reads. `compaction`/`generate` still receive
    // the persona, but must NOT overwrite that snapshot with their auxiliary
    // system prompts.
    const handlerFor = (persistSnapshot: boolean) =>
      async (event: PersonaInjectionEvent): Promise<void> => {
        await injectPersona(event, { ...deps, persistSnapshot })
      }

    // The agent loop + its compaction and generate variants share the context
    // shape; title generation is a separate hook and is intentionally omitted.
    await ctx.session.hook("context", handlerFor(true))
    await ctx.session.hook("compaction", handlerFor(false))
    await ctx.session.hook("generate", handlerFor(false))
  },
})
