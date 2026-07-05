// __tests__/app/log.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';
import { scanNote } from '@/src/parsing/scanNote';

jest.mock('@/lib/auth');
jest.mock('@/src/parsing/scanNote', () => ({ scanNote: jest.fn() }));

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const mockResolveLine = jest.fn();
const { scanNote: realScanNote } = jest.requireActual('@/src/parsing/scanNote');

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockReset().mockResolvedValue({
    resolvedTokens: [{ token: 'RDL', type: 'exercise', exerciseId: 'ex-1' }],
    unresolvedTokens: [],
  });
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine } });
  // Default: delegate to the real scanNote so existing behavior is exercised
  // for real. Only the race-condition test below overrides this per-call.
  // mockReset (not just mockClear) also drops any leftover queued
  // mockImplementationOnce entries and call-count history from a prior test —
  // jest.config.js doesn't set resetMocks/clearMocks globally.
  (scanNote as jest.Mock).mockReset().mockImplementation(realScanNote);
});

describe('LogScreen (notes-style)', () => {
  it('highlights a recognized set after the debounced scan and persists it', async () => {
    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');

    await fireEvent.changeText(input, 'Warmup, then RDL 40kg 8x3');

    await waitFor(
      () => {
        expect(screen.getByText('Warmup, then RDL 40kg 8x3')).toBeTruthy();
      },
      { timeout: 3000 },
    );

    // The highlight reflects the scan's in-memory result as soon as state
    // updates; the SQLite persist it triggers is a separate awaited step
    // that can still be in flight at that exact moment — wait for it too.
    await waitFor(async () => {
      const session = await getLocalSession(todayDate());
      expect(session?.notes).toBe('Warmup, then RDL 40kg 8x3');
      expect(session?.entries).toHaveLength(1);
      expect(session?.entries[0].exerciseId).toBe('ex-1');
    });
  });

  it('does not let a slow, stale scan overwrite a faster, newer one (out-of-order completion)', async () => {
    // Scan A (of the first, shorter text) is slow — e.g. it needed an LLM
    // round-trip. Scan B (of the second, longer text, typed shortly after)
    // is fast and settles FIRST. The screen must keep B's result; A's reply
    // arriving late must NOT stomp the newer state back to A's.
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;
    const pendingA = new Promise((res) => {
      resolveA = res;
    });
    const pendingB = new Promise((res) => {
      resolveB = res;
    });
    const entryA = {
      id: 'entry-a', exerciseId: 'ex-1', equipment: null, weightKg: 40, reps: 8, sets: 3,
      rawText: '40kg 8x3', parsedBy: 'DICTIONARY', order: 0, synced: 0,
      spanStart: 5, spanEnd: 13, status: 'resolved',
    };
    const entryB = {
      id: 'entry-b', exerciseId: 'ex-bp', equipment: null, weightKg: 50, reps: 5, sets: 5,
      rawText: '50kg 5x5', parsedBy: 'DICTIONARY', order: 0, synced: 0,
      spanStart: 16, spanEnd: 24, status: 'resolved',
    };
    (scanNote as jest.Mock)
      .mockImplementationOnce(() => pendingA)
      .mockImplementationOnce(() => pendingB);

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');

    // Type A and let its scan fire (in flight, unresolved).
    await fireEvent.changeText(input, 'RDL 40kg 8x3');
    await waitFor(() => expect(scanNote).toHaveBeenCalledTimes(1), { timeout: 3000 });

    // Before A resolves, the user keeps typing — B's scan fires too.
    await fireEvent.changeText(input, 'RDL 40kg 8x3\nBP 50kg 5x5');
    await waitFor(() => expect(scanNote).toHaveBeenCalledTimes(2), { timeout: 3000 });

    // B (the newer, later-triggered scan) settles FIRST.
    await act(async () => {
      resolveB([entryB]);
      await pendingB;
    });
    await waitFor(() => expect(screen.getByText('50kg 5x5')).toBeTruthy(), { timeout: 3000 });

    // A (the older, now-stale scan) settles LAST, with a DIFFERENT result.
    await act(async () => {
      resolveA([entryA]);
      await pendingA;
    });

    // Give the stale reply a chance to (wrongly) apply, then assert B's
    // result is still what's shown/persisted — not overwritten by A.
    await waitFor(async () => {
      expect(screen.getByText('50kg 5x5')).toBeTruthy();
      const session = await getLocalSession(todayDate());
      expect(session?.entries).toHaveLength(1);
      expect(session?.entries[0].id).toBe('entry-b');
    });
  });
});
