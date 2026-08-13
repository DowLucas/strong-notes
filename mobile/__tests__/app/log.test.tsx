// __tests__/app/log.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession, upsertLocalSession } from '@/src/db/sessionsRepo';
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

  it('tints an exercise blue when it has prior-session history', async () => {
    // A prior session (before today) for the same exercise the scan resolves to.
    await upsertLocalSession({
      date: '2020-01-02',
      notes: 'RDL 40kgx8',
      synced: 1,
      entries: [
        {
          id: 'prior-1',
          exerciseId: 'ex-1',
          equipment: null,
          weightKg: 40,
          reps: 8,
          sets: 1,
          rawText: '40kgx8',
          parsedBy: 'DICTIONARY',
          order: 0,
          synced: 1,
          spanStart: null,
          spanEnd: null,
        },
      ],
    });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'RDL 40kg 8x3');

    // The resolved span must carry exerciseId all the way to the editor for the
    // prior-history tint to apply — this guards that wiring end-to-end.
    await waitFor(
      () => {
        expect(screen.getByText('RDL 40kg 8x3')).toHaveStyle({ backgroundColor: '#DCE8FA' });
      },
      { timeout: 3000 },
    );
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

  it('confirms a clarifying-question answer: merges it into the exercise name and binds both tokens', async () => {
    mockResolveLine.mockReset().mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['As', 'Drip'],
      llmGuess: {
        exerciseName: 'Dip',
        muscles: ['CHEST', 'ARMS'],
        clarifyingQuestion: {
          token: 'As',
          question: 'What does "As" mean?',
          alternatives: ['Assisted', 'As many reps as possible'],
        },
      },
    });
    const createExercise = jest.fn().mockResolvedValue({ id: 'ex-dip', name: 'Assisted Dip', category: 'ISOLATION', createdAt: '' });
    const createAbbreviation = jest.fn().mockResolvedValue({});
    (useAuth as jest.Mock).mockReturnValue({
      api: { resolveLine: mockResolveLine, createExercise, createAbbreviation },
    });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'As Drip 8x3 50kg');

    // This line's single-group highlight spans the whole text, so a plain
    // (not-yet-scanned) segment and a highlighted one render identical text —
    // wait for it to actually become the tappable span (pointerEvents="auto"),
    // not just for the text to exist.
    await waitFor(
      () => expect(screen.getByText('As Drip 8x3 50kg').props.pointerEvents).toBe('auto'),
      { timeout: 3000 },
    );

    await fireEvent.press(screen.getByText('As Drip 8x3 50kg'));
    await waitFor(() => expect(screen.getByText('What does "As" mean?')).toBeTruthy());

    await fireEvent.press(screen.getByText('Assisted'));

    await waitFor(() => {
      expect(createExercise).toHaveBeenCalledWith({ name: 'Assisted Dip', muscles: ['CHEST', 'ARMS'] });
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'Drip', exerciseId: 'ex-dip' });
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'As', exerciseId: 'ex-dip' });
    });

    await waitFor(async () => {
      const session = await getLocalSession(todayDate());
      expect(session?.entries).toHaveLength(1);
      expect(session?.entries[0].exerciseId).toBe('ex-dip');
    });
  });
});
