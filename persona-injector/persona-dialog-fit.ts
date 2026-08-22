const MIN_DIALOG_HEIGHT = 8
const HEIGHT_HEADROOM = 3 // 1 "None" row + 2 headroom

/** Content-driven dialog scrollbox cap for the persona list.
 *  @param personaCount number of rendered persona rows (personas().length)
 *  Returns maxHeight = max(MIN_DIALOG_HEIGHT, personaCount + HEIGHT_HEADROOM)
 *  where HEIGHT_HEADROOM ≈ 1 "None" row + 2 headroom.
 *  The terminal clamp is applied later by wlib's resolveDialogMaxHeight. */
export function personaDialogMaxHeight(personaCount: number): number {
  return Math.max(MIN_DIALOG_HEIGHT, personaCount + HEIGHT_HEADROOM)
}