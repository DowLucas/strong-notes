// Pure geometry for keeping the editor's caret line visible above the
// keyboard. Kept free of React so the decisions are unit-testable.

/**
 * How much of the editor the keyboard covers, in points, from the editor's
 * bottom edge and the keyboard's top edge in window coordinates.
 */
export function keyboardOverlap(editorBottomY: number, keyboardTopY: number): number {
  // measureInWindow can report non-numeric geometry for a view that detached
  // between the keyboard event and the async callback. NaN here would reach
  // paddingBottom and scrollTo, and Android throws on a NaN style value.
  if (!Number.isFinite(editorBottomY) || !Number.isFinite(keyboardTopY)) return 0;
  return Math.max(0, editorBottomY - keyboardTopY);
}

/**
 * The scroll offset that reveals the caret line (plus `margin` of breathing
 * room) above the keyboard, or null when no scroll is needed — because the
 * line is already visible, or because nothing is visible at all.
 */
export function caretScrollTarget(input: {
  caretLineBottom: number;
  scrollOffset: number;
  viewportHeight: number;
  hiddenBottom: number;
  margin: number;
}): number | null {
  if (
    !Number.isFinite(input.caretLineBottom) ||
    !Number.isFinite(input.scrollOffset) ||
    !Number.isFinite(input.viewportHeight) ||
    !Number.isFinite(input.hiddenBottom)
  ) {
    return null;
  }
  const visibleHeight = input.viewportHeight - input.hiddenBottom;
  if (visibleHeight <= 0) return null;
  const wanted = input.caretLineBottom + input.margin;
  if (wanted <= input.scrollOffset + visibleHeight) return null;
  return Math.max(0, wanted - visibleHeight);
}
