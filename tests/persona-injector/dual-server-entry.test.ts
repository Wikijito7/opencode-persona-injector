import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import personaInjectorDual, {
  PersonaInjectorPlugin,
} from "../../persona-injector-server"
import { setup as serverSetup } from "../../persona-injector/server-setup"

/**
 * Regression tests for the official same-root dual-generation (v1 + v2) server
 * entrypoint and the v2 package's entrypoint hygiene.
 *
 * The single flat `persona-injector-server.ts` default export must stay the
 * official `{ id, server, setup }` shape so BOTH generations can auto-discover
 * it from one normal `~/.config/opencode/plugins/` root:
 *
 * - v1 (OpenCode 1.19) calls `server()`, which must be the same function as the
 *   named `PersonaInjectorPlugin`.
 * - v2 (OpenCode 2.x) decodes `id` + `setup` and strips the extra `server` key.
 *
 * The `persona-injector/` package must NOT expose a server entrypoint named
 * `index.ts` / `server.ts`, or the v2 server scanner would resolve a second
 * server plugin. Its retained v2 files are the TUI entry `tui.tsx` and the
 * non-entrypoint setup helper `server-setup.ts`.
 *
 * These assertions are filesystem/shape-only: the module is imported for its
 * export surface (the v2 `@opencode/plugin` `Context` import is type-only and
 * erased), and no live config, snapshot, or persona file is touched.
 */

const repoRoot = join(import.meta.dir, "..", "..")
const v2PackageDir = join(repoRoot, "persona-injector")

describe("persona-injector-server — official dual default export", () => {
  it("carries the `persona-injector` id", () => {
    expect(personaInjectorDual.id).toBe("persona-injector")
  })

  it("exposes `server` and `setup` as callable functions", () => {
    expect(typeof personaInjectorDual.server).toBe("function")
    expect(typeof personaInjectorDual.setup).toBe("function")
  })

  it("uses the named PersonaInjectorPlugin as its `server` (v1 surface)", () => {
    expect(typeof PersonaInjectorPlugin).toBe("function")
    expect(personaInjectorDual.server).toBe(PersonaInjectorPlugin)
  })

  it("uses the server-setup helper as its `setup` (v2 surface)", () => {
    expect(typeof serverSetup).toBe("function")
    expect(personaInjectorDual.setup).toBe(serverSetup)
  })

  it("keeps only the official { id, server, setup } keys on the default export", () => {
    expect(Object.keys(personaInjectorDual).sort()).toEqual([
      "id",
      "server",
      "setup",
    ])
  })
})

describe("persona-injector/ v2 package — entrypoint hygiene", () => {
  it("has no root `index.ts` server entrypoint", () => {
    expect(existsSync(join(v2PackageDir, "index.ts"))).toBe(false)
  })

  it("has no root `server.ts` server entrypoint", () => {
    expect(existsSync(join(v2PackageDir, "server.ts"))).toBe(false)
  })

  it("retains the v2 TUI entry `tui.tsx`", () => {
    expect(existsSync(join(v2PackageDir, "tui.tsx"))).toBe(true)
  })

  it("retains the non-entrypoint `server-setup.ts` helper", () => {
    expect(existsSync(join(v2PackageDir, "server-setup.ts"))).toBe(true)
  })
})
