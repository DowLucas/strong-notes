// __tests__/app/log.test.tsx
import { Keyboard } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getCachedAbbreviations } from '@/src/db/abbreviationsRepo';
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
  it('flushes the pending save and shows a "Saved" toast when the keyboard is dismissed', async () => {
    const listeners: Record<string, Array<() => void>> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
      (listeners[event] ??= []).push(cb);
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);

    await render(<LogScreen />);
    expect(screen.queryByText('Saved')).toBeNull();
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'RDL 40kg 8x3');

    // Leaving writing mode (keyboard hides) persists immediately — no need to
    // wait out the debounce — and confirms it.
    await act(async () => {
      for (const cb of listeners['keyboardDidHide'] ?? []) cb();
    });
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    const session = await getLocalSession(todayDate());
    expect(session?.notes).toBe('RDL 40kg 8x3');
  });

  it("shows today's log date above the editor", async () => {
    await render(<LogScreen />);
    const today = new Date().toISOString().slice(0, 10);
    const expected = new Date(today).toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    expect(screen.getByText(`Log for ${expected}`)).toBeTruthy();
  });

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

  it('shows a confirm bar for pending groups and confirms them all in one tap (skipping clarifying questions)', async () => {
    // Two lines need confirmation; one of them carries a clarifying question
    // and must be left for the user.
    mockResolveLine.mockReset().mockImplementation(async (line: string) => {
      if (line === 'As Drip') {
        return {
          resolvedTokens: [],
          unresolvedTokens: ['As', 'Drip'],
          llmGuess: {
            exerciseName: 'Dip',
            muscles: ['CHEST'],
            clarifyingQuestion: { token: 'As', question: 'What does "As" mean?', alternatives: ['Assisted', 'AMRAP'] },
          },
        };
      }
      return {
        resolvedTokens: [],
        unresolvedTokens: line.split(' '),
        llmGuess: { exerciseName: line === 'bb squats' ? 'Barbell Squat' : 'Barbell Rows', equipment: 'Barbell', equipmentToken: 'bb', muscles: ['QUADS'] },
      };
    });
    const createExercise = jest.fn().mockImplementation(async ({ name }: { name: string }) => ({ id: `ex-${name}`, name, category: 'COMPOUND', createdAt: '' }));
    const createAbbreviation = jest.fn().mockImplementation(async (input: { token: string }) => ({ id: `a-${input.token}`, token: input.token, source: 'USER_ADDED', createdAt: '' }));
    (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine, createExercise, createAbbreviation } });

    await render(<LogScreen />);
    expect(screen.queryByText(/to confirm/)).toBeNull();
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'bb squats 60kg 8x3\nbb rows 40kg 8x3\nAs Drip 8x3');

    await waitFor(() => expect(screen.getByText('3 exercises to confirm')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getAllByText(/Barbell Squat/).length).toBeGreaterThan(0);

    // Only the two groups without a clarifying question are bulk-confirmable.
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm all (2)' }));

    await waitFor(() => {
      expect(createExercise).toHaveBeenCalledWith({ name: 'Barbell Squat', muscles: ['QUADS'] });
      expect(createExercise).toHaveBeenCalledWith({ name: 'Barbell Rows', muscles: ['QUADS'] });
    });
    // The clarifying-question group is not auto-confirmed…
    expect(createExercise).not.toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining('Dip') }));
    // …and the bar says so.
    await waitFor(() => expect(screen.getByText('1 needs an answer — tap it')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('2 exercises confirmed')).toBeTruthy());
  });

  it('dismisses the confirm bar for the current pending set', async () => {
    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    mockResolveLine.mockReset().mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['squats'],
      llmGuess: { exerciseName: 'Squat', muscles: ['QUADS'] },
    });
    await fireEvent.changeText(input, 'squats 60kg 8x3');
    await waitFor(() => expect(screen.getByText('1 exercise to confirm')).toBeTruthy(), { timeout: 3000 });
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('1 exercise to confirm')).toBeNull();
  });

  it('confirms a multi-word name: binds every name token to the exercise and caches them locally', async () => {
    mockResolveLine.mockReset().mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['shoulder', 'rotation'],
      llmGuess: { exerciseName: 'Shoulder Rotation', muscles: ['SHOULDERS'] },
    });
    const createExercise = jest.fn().mockResolvedValue({ id: 'ex-sr', name: 'Shoulder Rotation', category: 'ISOLATION', createdAt: '' });
    const createAbbreviation = jest.fn().mockImplementation(async (input: { token: string }) => ({
      id: `abbr-${input.token}`, token: input.token.toUpperCase(), exerciseId: 'ex-sr', exerciseName: 'Shoulder Rotation', source: 'USER_ADDED', createdAt: '',
    }));
    (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine, createExercise, createAbbreviation } });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'shoulder rotation x8');
    await waitFor(() => expect(screen.getByText('shoulder rotation x8').props.pointerEvents).toBe('auto'), { timeout: 3000 });
    await fireEvent.press(screen.getByText('shoulder rotation x8'));
    await waitFor(() => expect(screen.getByText('Shoulder Rotation')).toBeTruthy());
    await fireEvent.press(screen.getByText('Confirm exercise'));

    await waitFor(() => {
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'shoulder', exerciseId: 'ex-sr' });
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'rotation', exerciseId: 'ex-sr' });
    });
    // The local dictionary cache learns them right away, so the next scan
    // (e.g. after a reload) resolves offline without asking the LLM again.
    await waitFor(async () => {
      const cached = await getCachedAbbreviations();
      expect(cached.map((a) => a.token).sort()).toEqual(['ROTATION', 'SHOULDER']);
    });
  });

  it('confirms an equipment-shorthand line: names the exercise with equipment and saves the shorthand as a modifier', async () => {
    mockResolveLine.mockReset().mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['bb', 'deadlifts'],
      llmGuess: {
        exerciseName: 'Deadlift',
        equipment: 'Barbell',
        equipmentToken: 'bb',
        muscles: ['HAMSTRINGS', 'GLUTES', 'BACK'],
      },
    });
    const createExercise = jest.fn().mockResolvedValue({ id: 'ex-dl', name: 'Barbell Deadlift', category: 'COMPOUND', createdAt: '' });
    const createAbbreviation = jest.fn().mockResolvedValue({});
    (useAuth as jest.Mock).mockReturnValue({
      api: { resolveLine: mockResolveLine, createExercise, createAbbreviation },
    });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'bb deadlifts 30kg 8x3');

    await waitFor(
      () => expect(screen.getByText('bb deadlifts 30kg 8x3').props.pointerEvents).toBe('auto'),
      { timeout: 3000 },
    );
    await fireEvent.press(screen.getByText('bb deadlifts 30kg 8x3'));
    await waitFor(() => expect(screen.getByText('Barbell Deadlift')).toBeTruthy());

    await fireEvent.press(screen.getByText('Confirm exercise'));

    await waitFor(() => {
      expect(createExercise).toHaveBeenCalledWith({ name: 'Barbell Deadlift', muscles: ['HAMSTRINGS', 'GLUTES', 'BACK'] });
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'deadlifts', exerciseId: 'ex-dl' });
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'bb', modifierType: 'equipment', modifierValue: 'Barbell' });
      expect(createAbbreviation).not.toHaveBeenCalledWith(expect.objectContaining({ token: 'bb', exerciseId: 'ex-dl' }));
    });
  });

  it('confirms an equipment-only line: saves the equipment modifier but binds no exercise alias', async () => {
    // "bb 30kg 8x3": the only unresolved token is equipment shorthand, so
    // there is no exercise-name token to bind — "bb" must NOT become an
    // alias of the created exercise.
    mockResolveLine.mockReset().mockResolvedValue({
      resolvedTokens: [],
      unresolvedTokens: ['bb'],
      llmGuess: { exerciseName: 'Barbell Complex', equipment: 'Barbell', equipmentToken: 'bb', muscles: ['BACK'] },
    });
    const createExercise = jest.fn().mockResolvedValue({ id: 'ex-bc', name: 'Barbell Complex', category: 'COMPOUND', createdAt: '' });
    const createAbbreviation = jest.fn().mockResolvedValue({});
    (useAuth as jest.Mock).mockReturnValue({
      api: { resolveLine: mockResolveLine, createExercise, createAbbreviation },
    });

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Start typing your workout…');
    await fireEvent.changeText(input, 'bb 30kg 8x3');
    await waitFor(() => expect(screen.getByText('bb 30kg 8x3').props.pointerEvents).toBe('auto'), { timeout: 3000 });
    await fireEvent.press(screen.getByText('bb 30kg 8x3'));
    await waitFor(() => expect(screen.getByText('Barbell Complex')).toBeTruthy());
    await fireEvent.press(screen.getByText('Confirm exercise'));

    await waitFor(() => {
      expect(createExercise).toHaveBeenCalledWith({ name: 'Barbell Complex', muscles: ['BACK'] });
      expect(createAbbreviation).toHaveBeenCalledTimes(1);
      expect(createAbbreviation).toHaveBeenCalledWith({ token: 'bb', modifierType: 'equipment', modifierValue: 'Barbell' });
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
