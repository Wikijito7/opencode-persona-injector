import { describe, expect, it } from "bun:test"
import {
  createPersonaSelectionPersister,
  persistPersonaSelection,
  type PersonaSelectionDeps,
} from "@persona-injector/persona-selection"
import type { PersonaInjectorConfig } from "@persona-injector/types"

/**
 * Pure unit tests for the host-independent persona-selection persistence.
 *
 * Every side effect (`write`, `labelFor`, `setError`, `notify`,
 * `onPersonaChanged`) is injected, so no UI runtime, host adapter, or
 * filesystem is involved. The recorded call order proves the outcome contract:
 * a rejected write must never look like a successful persistence.
 */

/** A promise plus its resolvers, for driving the in-flight guard deterministically. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Harness {
  deps: PersonaSelectionDeps
  /** Labels recorded in call order, e.g. "clear-error", "write:hero". */
  events: string[]
  writes: PersonaInjectorConfig[]
  errors: Array<string | null>
  notifications: string[]
  changed: Array<string | null>
}

/**
 * Build the injected deps plus recorders for every side effect.
 *
 * `write` defaults to a successful resolver; `labelFor` defaults to a lookup
 * against `labels`. The `events` array is the order oracle.
 */
function makeHarness(options: {
  write?: (config: PersonaInjectorConfig) => Promise<void>
  labels?: Record<string, string>
} = {}): Harness {
  const events: string[] = []
  const writes: PersonaInjectorConfig[] = []
  const errors: Array<string | null> = []
  const notifications: string[] = []
  const changed: Array<string | null> = []
  const labels = options.labels ?? { hero: "Hero", villain: "Villain" }

  const deps: PersonaSelectionDeps = {
    write: async (config) => {
      events.push(`write:${config.persona}`)
      writes.push(config)
      await (options.write ?? (async () => {}))(config)
    },
    labelFor: (id) => labels[id],
    setError: (message) => {
      events.push(`setError:${message}`)
      errors.push(message)
    },
    notify: (message) => {
      events.push(`notify:${message}`)
      notifications.push(message)
    },
    onPersonaChanged: (id) => {
      events.push(`changed:${id}`)
      changed.push(id)
    },
  }

  return { deps, events, writes, errors, notifications, changed }
}

describe("persistPersonaSelection — success", () => {
  it("clears the error, writes, notifies onPersonaChanged, then notifies in that order", async () => {
    const h = makeHarness()

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(true)
    expect(h.events).toEqual(["setError:null", "write:hero", "changed:hero", "notify:Hero enabled"])
    expect(h.changed).toEqual(["hero"])
    expect(h.notifications).toEqual(["Hero enabled"])
    expect(h.errors).toEqual([null])
  })

  it("writes the selection as { persona: id }", async () => {
    const h = makeHarness()

    await persistPersonaSelection("villain", h.deps)

    expect(h.writes).toEqual([{ persona: "villain" }])
  })

  it("falls back to the id as the label when labelFor returns undefined", async () => {
    const h = makeHarness({ labels: {} })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(true)
    expect(h.notifications).toEqual(["hero enabled"])
  })

  it("enables with the resolved display name", async () => {
    const h = makeHarness()

    await persistPersonaSelection("hero", h.deps)

    expect(h.notifications).toEqual(["Hero enabled"])
  })

  it("disables with a null id and the disable message", async () => {
    const h = makeHarness()

    const ok = await persistPersonaSelection(null, h.deps)

    expect(ok).toBe(true)
    expect(h.events).toEqual(["setError:null", "write:null", "changed:null", "notify:Persona disabled"])
    expect(h.writes).toEqual([{ persona: null }])
    expect(h.changed).toEqual([null])
    expect(h.notifications).toEqual(["Persona disabled"])
  })

  it("does not call labelFor when disabling", async () => {
    let labelForCalls = 0
    const h = makeHarness()
    h.deps.labelFor = () => {
      labelForCalls += 1
      return "unused"
    }

    await persistPersonaSelection(null, h.deps)

    expect(labelForCalls).toBe(0)
  })
})

describe("persistPersonaSelection — write rejection", () => {
  it("records the inline error, notifies failure, and never calls onPersonaChanged", async () => {
    const h = makeHarness({
      write: async () => {
        throw new Error("disk full")
      },
    })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: disk full"])
    expect(h.notifications).toEqual(["Failed to enable Hero"])
    expect(h.changed).toEqual([])
    expect(h.events).toEqual([
      "setError:null",
      "write:hero",
      "setError:Could not save persona selection: disk full",
      "notify:Failed to enable Hero",
    ])
  })

  it("uses the id as the failure label when labelFor returns undefined", async () => {
    const h = makeHarness({
      labels: {},
      write: async () => {
        throw new Error("nope")
      },
    })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.notifications).toEqual(["Failed to enable hero"])
    expect(h.changed).toEqual([])
  })

  it("notifies a disable failure without an enable label", async () => {
    const h = makeHarness({
      write: async () => {
        throw new Error("locked")
      },
    })

    const ok = await persistPersonaSelection(null, h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: locked"])
    expect(h.notifications).toEqual(["Failed to disable persona"])
    expect(h.changed).toEqual([])
  })

  it("stringifies a non-Error rejection in the inline error", async () => {
    const h = makeHarness({
      write: async () => {
        throw "plain boom"
      },
    })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: plain boom"])
  })

  it("resolves false rather than rejecting when the write rejects", async () => {
    const h = makeHarness({
      write: async () => {
        throw new Error("boom")
      },
    })

    await expect(persistPersonaSelection("hero", h.deps)).resolves.toBe(false)
  })
})

describe("persistPersonaSelection — hostile rejection formatting", () => {
  // describeError must always produce a readable inline error, even when the
  // thrown value actively sabotages string conversion. None of these may throw
  // out of persistPersonaSelection.

  it("falls back to <unprintable error> when the thrown value's toString throws", async () => {
    const hostile = {
      toString: () => {
        throw new Error("no string")
      },
    }
    const h = makeHarness({ write: async () => { throw hostile } })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: <unprintable error>"])
    expect(h.notifications).toEqual(["Failed to enable Hero"])
    expect(h.changed).toEqual([])
  })

  it("falls back to <unprintable error> when Symbol.toPrimitive throws", async () => {
    const hostile = {
      [Symbol.toPrimitive]: () => {
        throw new Error("no primitive")
      },
    }
    const h = makeHarness({ write: async () => { throw hostile } })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: <unprintable error>"])
  })

  it("falls back to <unprintable error> for a revoked Proxy rejection", async () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const h = makeHarness({ write: async () => { throw proxy } })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: <unprintable error>"])
  })

  it("falls back to <unprintable error> when an Error's message getter throws", async () => {
    const hostile = new Proxy(new Error("hidden"), {
      get(target, prop, receiver) {
        if (prop === "message") throw new Error("message getter boom")
        return Reflect.get(target, prop, receiver)
      },
    })
    const h = makeHarness({ write: async () => { throw hostile } })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: <unprintable error>"])
  })

  it("uses a custom toString() when the thrown value is stringifiable", async () => {
    const hostile = { toString: () => "custom failure" }
    const h = makeHarness({ write: async () => { throw hostile } })

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: custom failure"])
  })

  const PRIMITIVES: Array<[label: string, value: unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["0", 0],
  ]

  for (const [label, value] of PRIMITIVES) {
    it(`formats a thrown ${label} primitive without rejecting`, async () => {
      const h = makeHarness({ write: async () => { throw value } })

      await expect(persistPersonaSelection("hero", h.deps)).resolves.toBe(false)
      expect(h.errors).toEqual([null, `Could not save persona selection: ${String(value)}`])
    })
  }
})

describe("persistPersonaSelection — throwing labelFor falls back to the id", () => {
  it("uses the id as the failure label when labelFor throws", async () => {
    const h = makeHarness({
      write: async () => {
        throw new Error("locked")
      },
    })
    h.deps.labelFor = () => {
      throw new Error("label boom")
    }

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.errors).toEqual([null, "Could not save persona selection: locked"])
    expect(h.notifications).toEqual(["Failed to enable hero"])
    expect(h.changed).toEqual([])
  })

  it("uses the id as the enable label when labelFor throws", async () => {
    const h = makeHarness()
    h.deps.labelFor = () => {
      throw new Error("label boom")
    }

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(true)
    expect(h.writes).toEqual([{ persona: "hero" }])
    expect(h.notifications).toEqual(["hero enabled"])
  })
})

describe("persistPersonaSelection — throwing UI callbacks never change the outcome", () => {
  it("writes and resolves true when clearing the error throws", async () => {
    const h = makeHarness()
    let setErrorCalls = 0
    h.deps.setError = () => {
      setErrorCalls += 1
      throw new Error("setError boom")
    }

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(true)
    expect(setErrorCalls).toBe(1)
    expect(h.writes).toEqual([{ persona: "hero" }])
    expect(h.changed).toEqual(["hero"])
    expect(h.notifications).toEqual(["Hero enabled"])
  })

  it("still emits the failure notify and resolves false when setError throws on rejection", async () => {
    const h = makeHarness({
      write: async () => {
        throw new Error("disk full")
      },
    })
    h.deps.setError = () => {
      throw new Error("setError boom")
    }

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(false)
    expect(h.notifications).toEqual(["Failed to enable Hero"])
    expect(h.changed).toEqual([])
  })

  it("resolves true and still notifies when onPersonaChanged throws after a successful write", async () => {
    const h = makeHarness()
    h.deps.onPersonaChanged = () => {
      throw new Error("changed boom")
    }

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(true)
    expect(h.writes).toEqual([{ persona: "hero" }])
    expect(h.notifications).toEqual(["Hero enabled"])
  })

  it("resolves true and still calls onPersonaChanged when notify throws after a successful write", async () => {
    const h = makeHarness()
    h.deps.notify = () => {
      throw new Error("notify boom")
    }

    const ok = await persistPersonaSelection("hero", h.deps)

    expect(ok).toBe(true)
    expect(h.writes).toEqual([{ persona: "hero" }])
    expect(h.changed).toEqual(["hero"])
  })

  it("resolves true without rejecting when every UI callback throws", async () => {
    const h = makeHarness()
    h.deps.setError = () => {
      throw new Error("setError boom")
    }
    h.deps.onPersonaChanged = () => {
      throw new Error("changed boom")
    }
    h.deps.notify = () => {
      throw new Error("notify boom")
    }

    await expect(persistPersonaSelection("hero", h.deps)).resolves.toBe(true)
    expect(h.writes).toEqual([{ persona: "hero" }])
  })
})

describe("createPersonaSelectionPersister — in-flight guard", () => {
  it("suppresses a second call while the first write is pending, without side effects", async () => {
    const gate = deferred<void>()
    const h = makeHarness({ write: () => gate.promise })
    const persist = createPersonaSelectionPersister(h.deps)

    const first = persist("hero")
    // The first call runs synchronously through setError + write before its
    // first await, so the guard is already raised when the second call lands.
    const second = await persist("villain")

    expect(second).toBe(false)
    // The suppressed call wrote nothing and emitted nothing.
    expect(h.writes).toEqual([{ persona: "hero" }])
    expect(h.changed).toEqual([])
    expect(h.notifications).toEqual([])

    gate.resolve()
    await expect(first).resolves.toBe(true)
    expect(h.changed).toEqual(["hero"])
    expect(h.notifications).toEqual(["Hero enabled"])
  })

  it("does not suppress a subsequent call after the first settles", async () => {
    const gate = deferred<void>()
    const h = makeHarness({ write: () => gate.promise })
    const persist = createPersonaSelectionPersister(h.deps)

    const first = persist("hero")
    gate.resolve()
    await expect(first).resolves.toBe(true)

    const second = await persist("villain")

    expect(second).toBe(true)
    expect(h.writes).toEqual([{ persona: "hero" }, { persona: "villain" }])
    expect(h.changed).toEqual(["hero", "villain"])
  })

  it("resets the guard after a rejected write so a retry can proceed", async () => {
    const gate = deferred<void>()
    const h = makeHarness({ write: () => gate.promise })
    const persist = createPersonaSelectionPersister(h.deps)

    const first = persist("hero")
    const suppressed = await persist("villain")
    expect(suppressed).toBe(false)

    gate.reject(new Error("disk full"))
    await expect(first).resolves.toBe(false)
    expect(h.changed).toEqual([])
    expect(h.notifications).toEqual(["Failed to enable Hero"])

    // Guard is back down — the retry writes and succeeds.
    const retryGate = deferred<void>()
    h.deps.write = async (config) => {
      h.writes.push(config)
      await retryGate.promise
    }
    const retry = persist("villain")
    retryGate.resolve()
    await expect(retry).resolves.toBe(true)
    expect(h.changed).toEqual(["villain"])
  })

  it("serializes repeated presses of the same id into a single write", async () => {
    const gate = deferred<void>()
    const h = makeHarness({ write: () => gate.promise })
    const persist = createPersonaSelectionPersister(h.deps)

    const first = persist("hero")
    const second = persist("hero")
    const third = persist("hero")

    gate.resolve()
    const results = await Promise.all([first, second, third])

    expect(results).toEqual([true, false, false])
    expect(h.writes).toEqual([{ persona: "hero" }])
    expect(h.notifications).toEqual(["Hero enabled"])
  })
})
