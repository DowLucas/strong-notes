import { scaleRuns, xScale, monthBoundaries, thinLabels, niceTicks } from '@/src/components/chartScale';

const pad = { top: 0, right: 0, bottom: 0, left: 0 };

describe('chartScale', () => {
  it('places x by real elapsed days, not by index', () => {
    const x = xScale([{ date: '2026-06-01' }, { date: '2026-06-02' }, { date: '2026-06-11' }], 100, pad);
    expect(x('2026-06-01')).toBe(0);
    expect(x('2026-06-02')).toBe(10);
    expect(x('2026-06-11')).toBe(100);
  });

  it('pads a flat series ±5% so the line has room', () => {
    const { min, max } = scaleRuns([{ date: '2026-06-01', value: 100 }, { date: '2026-06-08', value: 100 }], 100, 100, pad);
    expect(min).toBe(95);
    expect(max).toBe(105);
  });

  it('lists real month boundaries between two dates', () => {
    expect(monthBoundaries('2025-11-15', '2026-02-10')).toEqual(['2025-12-01', '2026-01-01', '2026-02-01']);
    expect(monthBoundaries('2026-06-03', '2026-06-28')).toEqual([]);
    expect(monthBoundaries('2026-06-01', '2026-07-01')).toEqual(['2026-07-01']);
  });

  it('thins labels that sit closer than the minimum gap', () => {
    expect(thinLabels([{ x: 0 }, { x: 20 }, { x: 36 }, { x: 60 }, { x: 90 }], 36)).toEqual([{ x: 0 }, { x: 36 }, { x: 90 }]);
  });

  it('keeps ticks on round numbers', () => {
    expect(niceTicks(95, 105)).toEqual([95, 100, 105]);
    expect(niceTicks(1200, 4300)).toEqual([0, 2000, 4000, 6000]);
  });
});
