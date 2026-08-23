import { formatLongDate } from '@/lib/i18n';

describe('formatLongDate', () => {
  it('formats a YYYY-MM-DD string as a local calendar date (no UTC shift)', () => {
    // Compare against an explicitly local-constructed date so the expectation
    // holds in every test-runner timezone.
    const expected = new Date(2026, 7, 23).toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    expect(formatLongDate('2026-08-23')).toBe(expected);
    expect(formatLongDate('2026-08-23')).toMatch(/23/);
    expect(formatLongDate('2026-08-23')).toMatch(/Sunday/);
  });
});
