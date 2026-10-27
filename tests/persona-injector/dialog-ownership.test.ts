import { describe, expect, it } from "bun:test"
import {
  closeIfOwned,
  createDialogOwnership,
  persistAndCloseIfOwned,
  type DialogOwnership,
} from "@persona-injector/dialog-ownership"

/**
 * Pure unit tests for the host-independent dialog-ownership guard.
 *
 * The guard exists so an async Enter-path write (or a queued Escape) that
 * resolves after its dialog was dismissed or replaced can never clear a
 * *newer* dialog. Every side effect here is an injected closure, so no UI
 * runtime or host adapter is involved; the recorded call counts are the
 * contract oracle.
 */

/** A promise plus its resolvers, for driving the in-flight race deterministically. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A call-recording close callback, so a stray `close` is observable. */
function spyClose(): { close: () => void; calls: number } {
  const state = { close: () => {}, calls: 0 }
  state.close = () => {
    state.calls += 1
  }
  return state
}

describe("createDialogOwnership — lifecycle", () => {
  it("starts inactive", () => {
    const ownership = createDialogOwnership()

    expect(ownership.isActive()).toBe(false)
  })

  it("becomes active after activate()", () => {
    const ownership = createDialogOwnership()

    ownership.activate()

    expect(ownership.isActive()).toBe(true)
  })

  it("becomes inactive again after invalidate()", () => {
    const ownership = createDialogOwnership()
    ownership.activate()

    ownership.invalidate()

    expect(ownership.isActive()).toBe(false)
  })

  it("can be re-activated after being invalidated", () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    ownership.invalidate()

    ownership.activate()

    expect(ownership.isActive()).toBe(true)
  })

  it("keeps separate tokens independent", () => {
    const older = createDialogOwnership()
    const newer = createDialogOwnership()
    older.activate()
    newer.activate()

    older.invalidate()

    expect(older.isActive()).toBe(false)
    expect(newer.isActive()).toBe(true)
  })
})

describe("createDialogOwnership — generation monotonicity", () => {
  it("starts at zero and strictly increases across activate/invalidate/re-activate", () => {
    const ownership = createDialogOwnership()
    const start = ownership.generation()

    ownership.activate()
    const afterActivate = ownership.generation()
    ownership.invalidate()
    const afterInvalidate = ownership.generation()
    ownership.activate()
    const afterReactivate = ownership.generation()

    expect(start).toBe(0)
    expect(afterActivate).toBeGreaterThan(start)
    expect(afterInvalidate).toBeGreaterThan(afterActivate)
    expect(afterReactivate).toBeGreaterThan(afterInvalidate)
  })

  it("bumps the generation on every invalidate, even when already inactive", () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const before = ownership.generation()

    ownership.invalidate()
    const afterFirst = ownership.generation()
    ownership.invalidate()
    const afterSecond = ownership.generation()

    expect(afterFirst).toBeGreaterThan(before)
    expect(afterSecond).toBeGreaterThan(afterFirst)
    expect(ownership.isActive()).toBe(false)
  })

  it("keeps generations independent between tokens", () => {
    const first = createDialogOwnership()
    const second = createDialogOwnership()
    first.activate()
    first.activate()
    first.activate()

    expect(second.generation()).toBe(0)
    first.invalidate()
    expect(second.generation()).toBe(0)
    expect(first.generation()).toBeGreaterThan(3)
  })
})

describe("persistAndCloseIfOwned — stale Enter does not begin persistence", () => {
  it("does not call persist or close when the token is inactive", async () => {
    const ownership = createDialogOwnership() // never activated
    const close = spyClose()
    let persistCalls = 0
    const persist = async () => {
      persistCalls += 1
      return true
    }

    const closed = await persistAndCloseIfOwned(ownership, persist, close.close)

    expect(closed).toBe(false)
    expect(persistCalls).toBe(0)
    expect(close.calls).toBe(0)
  })

  it("does not begin persistence when the token was invalidated before Enter", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    ownership.invalidate()
    const close = spyClose()
    let persistCalls = 0

    const closed = await persistAndCloseIfOwned(
      ownership,
      async () => {
        persistCalls += 1
        return true
      },
      close.close,
    )

    expect(closed).toBe(false)
    expect(persistCalls).toBe(0)
    expect(close.calls).toBe(0)
  })
})

describe("persistAndCloseIfOwned — active success clears once", () => {
  it("resolves true and closes exactly once when the write succeeds while owned", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const close = spyClose()
    let persistCalls = 0

    const closed = await persistAndCloseIfOwned(
      ownership,
      async () => {
        persistCalls += 1
        return true
      },
      close.close,
    )

    expect(closed).toBe(true)
    expect(persistCalls).toBe(1)
    expect(close.calls).toBe(1)
    expect(ownership.isActive()).toBe(true)
  })
})

describe("persistAndCloseIfOwned — failure keeps the dialog open", () => {
  it("resolves false and does not close when persist resolves false", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const close = spyClose()

    const closed = await persistAndCloseIfOwned(ownership, async () => false, close.close)

    expect(closed).toBe(false)
    expect(close.calls).toBe(0)
  })

  it("resolves false without clearing and leaves ownership active when persist rejects", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const close = spyClose()

    const closed = await persistAndCloseIfOwned(
      ownership,
      async () => {
        throw new Error("write boom")
      },
      close.close,
    )

    expect(closed).toBe(false)
    expect(close.calls).toBe(0)
    // A failed write must not invalidate the dialog — the caller keeps it open
    // (with its inline error) for a retry.
    expect(ownership.isActive()).toBe(true)
  })
})

describe("persistAndCloseIfOwned — pending write dismissed before completion", () => {
  it("does not clear when the write resolves true after invalidation", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const gate = deferred<boolean>()
    const close = spyClose()

    const pending = persistAndCloseIfOwned(ownership, () => gate.promise, close.close)
    // The dialog is dismissed while the write is still in flight.
    ownership.invalidate()
    gate.resolve(true)

    const closed = await pending

    expect(closed).toBe(false)
    expect(close.calls).toBe(0)
  })

  it("does not clear a dialog that was never closed by us", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const gate = deferred<boolean>()
    const close = spyClose()

    const pending = persistAndCloseIfOwned(ownership, () => gate.promise, close.close)
    ownership.invalidate()
    gate.resolve(true)
    await pending

    // A later activation of the *same* token is a new dialog epoch; the old
    // resolution already ran and must not have cleared it.
    ownership.activate()
    expect(ownership.isActive()).toBe(true)
    expect(close.calls).toBe(0)
  })

  it("cannot clear the reactivated epoch when an epoch-1 write resolves after invalidate+reactivate", async () => {
    const ownership = createDialogOwnership()
    ownership.activate() // epoch 1
    const epoch1 = ownership.generation()
    const gate = deferred<boolean>()
    const close = spyClose()

    // An Enter-path write begins under epoch 1 and stays in flight.
    const pending = persistAndCloseIfOwned(ownership, () => gate.promise, close.close)

    // Dismiss (Escape/backdrop) and immediately reopen a fresh dialog on the
    // same token: invalidate() then activate() crosses an ownership boundary,
    // so the token now reports a *newer* epoch than the one the write captured.
    ownership.invalidate()
    ownership.activate()
    const epochAfterReactivate = ownership.generation()

    // The epoch-1 write finally resolves true — but a later epoch owns the
    // screen now, and isActive() alone would have read true and let it through.
    gate.resolve(true)
    const closed = await pending

    expect(closed).toBe(false)
    expect(close.calls).toBe(0)
    expect(ownership.generation()).toBeGreaterThan(epoch1)
    expect(ownership.generation()).toBe(epochAfterReactivate)
    // The reactivated epoch survives the stale resolution and is still closable
    // by its own path.
    expect(ownership.isActive()).toBe(true)
    const ownClose = spyClose()
    expect(closeIfOwned(ownership, ownClose.close)).toBe(true)
    expect(ownClose.calls).toBe(1)
  })
})

describe("persistAndCloseIfOwned — pending write replaced before completion", () => {
  it("does not clear the newer dialog when the older write resolves", async () => {
    const older = createDialogOwnership()
    older.activate()
    const gate = deferred<boolean>()
    const closeOlder = spyClose()
    const closeNewer = spyClose()

    const pending = persistAndCloseIfOwned(older, () => gate.promise, closeOlder.close)

    // A newer dialog replaces the older one on screen.
    older.invalidate()
    const newer = createDialogOwnership()
    newer.activate()

    gate.resolve(true)
    const closed = await pending

    expect(closed).toBe(false)
    expect(closeOlder.calls).toBe(0)
    expect(closeNewer.calls).toBe(0)
    // The new dialog is still the owner and can still be closed by its own path.
    expect(newer.isActive()).toBe(true)
    expect(closeIfOwned(newer, closeNewer.close)).toBe(true)
    expect(closeNewer.calls).toBe(1)
  })
})

describe("persistAndCloseIfOwned — repeated Enter", () => {
  it("does not begin persistence or close again once the first Enter cleared the dialog", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const close = spyClose()
    let persistCalls = 0
    const persist = async () => {
      persistCalls += 1
      return true
    }

    const first = await persistAndCloseIfOwned(ownership, persist, close.close)
    // The host's onClose fires on clear and invalidates the token.
    ownership.invalidate()

    const second = await persistAndCloseIfOwned(ownership, persist, close.close)
    const third = await persistAndCloseIfOwned(ownership, persist, close.close)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(third).toBe(false)
    expect(persistCalls).toBe(1)
    expect(close.calls).toBe(1)
  })

  it("runs every concurrently-pending Enter independently while still owned", async () => {
    // The guard itself has no in-flight dedupe — that lives in the persister.
    // Here we only prove an active token does not silently drop a second call.
    const ownership = createDialogOwnership()
    ownership.activate()
    const gate = deferred<boolean>()
    const close = spyClose()
    let persistCalls = 0
    const persist = () => {
      persistCalls += 1
      return gate.promise
    }

    const first = persistAndCloseIfOwned(ownership, persist, close.close)
    const second = persistAndCloseIfOwned(ownership, persist, close.close)
    gate.resolve(true)
    const results = await Promise.all([first, second])

    expect(persistCalls).toBe(2)
    expect(results).toEqual([true, true])
    expect(close.calls).toBe(2)
  })
})

describe("closeIfOwned — Escape path", () => {
  it("closes and resolves true while the token is active", () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const close = spyClose()

    const closed = closeIfOwned(ownership, close.close)

    expect(closed).toBe(true)
    expect(close.calls).toBe(1)
  })

  it("does not close and resolves false when the token is inactive", () => {
    const ownership = createDialogOwnership()
    const close = spyClose()

    const closed = closeIfOwned(ownership, close.close)

    expect(closed).toBe(false)
    expect(close.calls).toBe(0)
  })

  it("does not close and resolves false after invalidation", () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    ownership.invalidate()
    const close = spyClose()

    const closed = closeIfOwned(ownership, close.close)

    expect(closed).toBe(false)
    expect(close.calls).toBe(0)
  })
})

describe("closeIfOwned — a stale Escape cannot clear a newer dialog", () => {
  it("ignores the stale close and lets the newer token clear instead", () => {
    const older = createDialogOwnership()
    older.activate()
    const newer = createDialogOwnership()
    newer.activate()
    // The older dialog was replaced: its Escape binding is now stale.
    older.invalidate()
    const clear = spyClose()

    const staleClosed = closeIfOwned(older, clear.close)
    const freshClosed = closeIfOwned(newer, clear.close)

    expect(staleClosed).toBe(false)
    expect(freshClosed).toBe(true)
    expect(clear.calls).toBe(1)
  })

  it("leaves a newer dialog on screen when only the stale Escape fires", () => {
    const older = createDialogOwnership()
    older.activate()
    const newer = createDialogOwnership()
    newer.activate()
    older.invalidate()
    const clear = spyClose()

    const closed = closeIfOwned(older, clear.close)

    expect(closed).toBe(false)
    expect(clear.calls).toBe(0)
    expect(newer.isActive()).toBe(true)
  })
})

describe("dialog-ownership — dismissed-then-stale-Enter interplay", () => {
  it("a dismissed dialog cannot start persistence or clear, and does not disturb a replacement", async () => {
    const ownership = createDialogOwnership()
    ownership.activate()
    const close = spyClose()
    let persistCalls = 0
    const persist = async () => {
      persistCalls += 1
      return true
    }

    // Dismissed (escape/backdrop) before the queued Enter is dispatched.
    ownership.invalidate()

    const staleClosed = await persistAndCloseIfOwned(ownership, persist, close.close)
    const staleEscape = closeIfOwned(ownership, close.close)

    expect(staleClosed).toBe(false)
    expect(staleEscape).toBe(false)
    expect(persistCalls).toBe(0)
    expect(close.calls).toBe(0)
  })

  it("allows a fresh dialog to persist and close after the old one was replaced", async () => {
    const older = createDialogOwnership()
    older.activate()
    const close = spyClose()
    older.invalidate()

    const newer = createDialogOwnership()
    newer.activate()
    let persistCalls = 0

    const closed = await persistAndCloseIfOwned(
      newer,
      async () => {
        persistCalls += 1
        return true
      },
      close.close,
    )

    expect(closed).toBe(true)
    expect(persistCalls).toBe(1)
    expect(close.calls).toBe(1)
  })
})

describe("dialog-ownership — tokens are distinct across dialogs", () => {
  it("carries no shared state between two owned tokens", async () => {
    const first = createDialogOwnership()
    const second = createDialogOwnership()
    first.activate()
    second.activate()
    const closeFirst = spyClose()
    const gate = deferred<boolean>()

    const pending = persistAndCloseIfOwned(first, () => gate.promise, closeFirst.close)
    first.invalidate()
    gate.resolve(true)
    await pending

    expect(first.isActive()).toBe(false)
    expect(second.isActive()).toBe(true)
    expect(closeFirst.calls).toBe(0)

    const closeSecond = spyClose()
    expect(await persistAndCloseIfOwned(second, async () => true, closeSecond.close)).toBe(true)
    expect(closeSecond.calls).toBe(1)
  })
})
