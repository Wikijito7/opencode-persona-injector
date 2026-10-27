import { describe, expect, it } from "bun:test"
import { PersonaInjectorPlugin } from "../../persona-injector-server"

/**
 * Tests for the deprecated v1 server entrypoint's hook-level guarantees.
 *
 * The v1 `experimental.chat.system.transform` hook does not inject its
 * dependencies — it imports the real `isTitleGenerator` and `writeSystemSnapshot`
 * from wlib and reads the live config. Only the fail-closed predicate path is
 * exercised here: it aborts before `readConfig`/`loadPersonas`/`writeSystemSnapshot`,
 * so the test touches no live config or snapshot file.
 *
 * The `chat.message` hook touches no config or snapshot at all, so its error
 * path IS exercised: a pathological `input.agent` / `output.parts` is driven
 * through the real hook and the hook must still resolve (the log line is built
 * before the agent is trusted, and `errorMessage` must never throw on the way
 * back out). What this seam CANNOT observe is the *content* of the resulting
 * log line: the hook imports the real, non-injected wlib logger, which is a
 * no-op unless `OPENCODE_WLIB_DEBUG=true` at module-eval time and otherwise
 * writes to the repo's `logs/` directory. Asserting the logged text would need
 * module mocking or a real log file, both worse than the non-rejection
 * guarantee proven here.
 *
 * The "rejecting snapshot" guarantee is intentionally NOT covered here: the real
 * `writeSystemSnapshot` never rejects (it swallows its own I/O errors), so
 * exercising the hook's `catch` around it would require mocking the wlib module
 * in the shared registry — fragile, and liable to bleed into other suites. The
 * same guarantee is covered with a fully-injected writer in
 * `injection.test.ts` (`injectPersona — writeSnapshot resilience`).
 */

type TransformHook = (
  input: { sessionID?: string; model: unknown },
  output: { system: string[] },
) => Promise<void>

type ChatMessageHook = (
  input: {
    sessionID: string
    agent?: string
    model?: { providerID: string; modelID: string }
    messageID?: string
    variant?: string
  },
  output: { message: unknown; parts: unknown[] },
) => Promise<void>

async function getTransformHook(): Promise<TransformHook> {
  const plugin = await PersonaInjectorPlugin()
  return plugin["experimental.chat.system.transform"] as unknown as TransformHook
}

async function getChatMessageHook(): Promise<ChatMessageHook> {
  const plugin = await PersonaInjectorPlugin()
  return plugin["chat.message"] as unknown as ChatMessageHook
}

describe("PersonaInjectorPlugin (v1) — hook surface", () => {
  it("exposes the system.transform and chat.message hooks as functions", async () => {
    const plugin = await PersonaInjectorPlugin()

    expect(typeof plugin["experimental.chat.system.transform"]).toBe("function")
    expect(typeof plugin["chat.message"]).toBe("function")
  })
})

describe("PersonaInjectorPlugin (v1) — thrown title predicate fails closed", () => {
  it("resolves (never rejects) when the title predicate throws on a malformed system", async () => {
    const hook = await getTransformHook()
    // `isTitleGenerator` calls `system.join("\n")`; a non-array system makes it
    // throw, which is the only way to drive the v1 hook's predicate catch without
    // mocking the imported module.
    const output = { system: null as unknown as string[] }

    await expect(hook({ sessionID: "session-boom", model: {} }, output)).resolves.toBeUndefined()
    // Aborted in the predicate catch, before any mutation or snapshot.
    expect(output.system).toBeNull()
  })

  it("leaves a system whose join throws untouched and still resolves", async () => {
    const hook = await getTransformHook()
    const exploding = {
      join: () => {
        throw new Error("predicate boom")
      },
    } as unknown as string[]
    const output = { system: exploding }

    await expect(hook({ sessionID: "session-boom-2", model: {} }, output)).resolves.toBeUndefined()
    expect(output.system).toBe(exploding)
  })
})

describe("PersonaInjectorPlugin (v1) — chat.message pathological input never rejects", () => {
  it("resolves (never rejects) when input.agent.toLowerCase throws a hostile value", async () => {
    const hook = await getChatMessageHook()
    // `input.agent?.toLowerCase()` invokes a hostile `toLowerCase` that throws a
    // value that cannot itself be stringified. The hook's catch calls
    // `errorMessage`, which must swallow the unprintable value rather than
    // turning the logger into the failure.
    const hostile = {
      toLowerCase() {
        throw {
          toString() {
            throw new Error("cannot stringify")
          },
        }
      },
    }

    await expect(
      hook(
        { sessionID: "chat-hostile-agent", agent: hostile as unknown as string },
        { message: {}, parts: [] },
      ),
    ).resolves.toBeUndefined()
  })

  it("resolves (never rejects) when the FIRED log line's parts.length getter throws", async () => {
    const hook = await getChatMessageHook()
    // The very first statement builds the log line, which reads
    // `output.parts?.length` — before any agent is trusted. A throwing length
    // getter must be caught, never escape the hook.
    const parts = new Proxy([] as unknown[], {
      get(target, prop, receiver) {
        if (prop === "length") throw new Error("parts length boom")
        return Reflect.get(target, prop, receiver)
      },
    })

    await expect(
      hook(
        { sessionID: "chat-hostile-parts", agent: "build" },
        { message: {}, parts },
      ),
    ).resolves.toBeUndefined()
  })

  it("resolves (never rejects) for a non-string agent without a toLowerCase", async () => {
    const hook = await getChatMessageHook()

    await expect(
      hook(
        { sessionID: "chat-number-agent", agent: 42 as unknown as string },
        { message: {}, parts: [] },
      ),
    ).resolves.toBeUndefined()
  })
})
