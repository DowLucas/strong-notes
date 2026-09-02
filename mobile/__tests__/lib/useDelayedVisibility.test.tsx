import { act, renderHook } from '@testing-library/react-native';
import { useDelayedVisibility } from '@/lib/useDelayedVisibility';

const OPTS = { delayMs: 350, minVisibleMs: 500 };

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

function setup(active: boolean) {
  return renderHook(({ active: a }: { active: boolean }) => useDelayedVisibility(a, OPTS), {
    initialProps: { active },
  });
}

describe('useDelayedVisibility', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('is hidden while nothing is happening', async () => {
    const { result } = await setup(false);
    expect(result.current).toBe(false);
    await advance(5000);
    expect(result.current).toBe(false);
  });

  it('stays hidden for work that finishes before the delay — the flash never happens', async () => {
    const { result, rerender } = await setup(true);
    await advance(300);
    expect(result.current).toBe(false);
    await rerender({ active: false });
    await advance(5000);
    expect(result.current).toBe(false);
  });

  it('appears once the work outlasts the delay', async () => {
    const { result } = await setup(true);
    await advance(349);
    expect(result.current).toBe(false);
    await advance(1);
    expect(result.current).toBe(true);
  });

  it('once shown, stays up for the minimum visible time even if the work ends at once', async () => {
    const { result, rerender } = await setup(true);
    await advance(350);
    expect(result.current).toBe(true);

    await rerender({ active: false });
    await advance(499);
    expect(result.current).toBe(true);
    await advance(1);
    expect(result.current).toBe(false);
  });

  it('counts the hold from when it appeared, not from when the work ended', async () => {
    const { result, rerender } = await setup(true);
    await advance(350 + 400); // visible for 400ms already
    await rerender({ active: false });
    await advance(100); // 500ms total visible
    expect(result.current).toBe(false);
  });

  it('does not blink when work restarts during the hold', async () => {
    const { result, rerender } = await setup(true);
    await advance(350);
    await rerender({ active: false });
    await advance(100);
    expect(result.current).toBe(true);

    await rerender({ active: true }); // a new scan starts before the hold ends
    await advance(5000);
    expect(result.current).toBe(true);

    await rerender({ active: false });
    await advance(500);
    expect(result.current).toBe(false);
  });
});
