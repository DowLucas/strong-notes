import { progressColor } from '@/src/science/muscleColor';

describe('progressColor', () => {
  it('returns a low-intensity color when far under target', () => {
    expect(progressColor(1, 12, 20)).toBe('#fde2e2');
  });

  it('returns a mid-intensity color within target range', () => {
    expect(progressColor(15, 12, 20)).toBe('#f59e42');
  });

  it('returns a high-intensity color at or above target max', () => {
    expect(progressColor(20, 12, 20)).toBe('#dc2626');
  });

  it('treats zero actual sets as the lowest intensity', () => {
    expect(progressColor(0, 12, 20)).toBe('#fde2e2');
  });
});
