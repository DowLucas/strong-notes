import { caretScrollTarget, keyboardOverlap } from '@/lib/caretScroll';

describe('keyboardOverlap', () => {
  it('is zero when the keyboard sits entirely below the editor', () => {
    expect(keyboardOverlap(500, 600)).toBe(0);
    expect(keyboardOverlap(500, 500)).toBe(0);
  });

  it('is the part of the editor the keyboard covers', () => {
    // Editor bottom edge at y=700, keyboard top edge at y=380 → 320pt hidden.
    expect(keyboardOverlap(700, 380)).toBe(320);
  });
});

describe('caretScrollTarget', () => {
  const base = { viewportHeight: 600, hiddenBottom: 320, margin: 52, scrollOffset: 0 };

  it('does nothing while the caret line (plus breathing room) is already visible', () => {
    // Visible height 280; caret line bottom 200 + 52 margin = 252 ≤ 280.
    expect(caretScrollTarget({ ...base, caretLineBottom: 200 })).toBeNull();
  });

  it('scrolls just enough to reveal the caret line above the keyboard', () => {
    // Wanted bottom 300 + 52 = 352; visible 280 → scroll 72.
    expect(caretScrollTarget({ ...base, caretLineBottom: 300 })).toBe(72);
  });

  it('accounts for the current scroll offset', () => {
    // Already scrolled 72: caret at 300 is visible; caret at 326 needs 26 more.
    expect(caretScrollTarget({ ...base, scrollOffset: 72, caretLineBottom: 300 })).toBeNull();
    expect(caretScrollTarget({ ...base, scrollOffset: 72, caretLineBottom: 326 })).toBe(98);
  });

  it('never scrolls to a negative offset', () => {
    expect(caretScrollTarget({ ...base, hiddenBottom: 0, caretLineBottom: 10, scrollOffset: 0 })).toBeNull();
    expect(caretScrollTarget({ ...base, viewportHeight: 100, hiddenBottom: 60, caretLineBottom: 0 })).toBe(12);
  });

  it('refuses to scroll when the keyboard covers the whole viewport (nothing can be revealed)', () => {
    expect(caretScrollTarget({ ...base, viewportHeight: 300, hiddenBottom: 300, caretLineBottom: 400 })).toBeNull();
    expect(caretScrollTarget({ ...base, viewportHeight: 300, hiddenBottom: 350, caretLineBottom: 400 })).toBeNull();
  });
});
