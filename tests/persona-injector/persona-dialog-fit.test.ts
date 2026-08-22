import { describe, expect, it } from "bun:test"
import { personaDialogMaxHeight } from "@persona-injector/persona-dialog-fit"

describe("personaDialogMaxHeight", () => {
  it("floors small persona counts to the MIN cap of 8", () => {
    expect(personaDialogMaxHeight(0)).toBe(8)
  })

  it("floors 3 personas (3+3=6) up to the MIN cap of 8", () => {
    expect(personaDialogMaxHeight(3)).toBe(8)
  })

  it("returns count + 3 for 10 personas", () => {
    expect(personaDialogMaxHeight(10)).toBe(13)
  })

  it("returns count + 3 for 100 personas", () => {
    expect(personaDialogMaxHeight(100)).toBe(103)
  })

  it("grows monotonically as persona count grows", () => {
    expect(personaDialogMaxHeight(50)).toBeGreaterThan(personaDialogMaxHeight(5))
  })
})