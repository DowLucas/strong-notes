import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';
import { getLocalSession } from '../../src/db/sessionsRepo';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockResolvedValue({ resolvedTokens: [], unresolvedTokens: [] });
});

describe('LogScreen', () => {
  it('adds a parsed line to the list after submitting text', async () => {
    await render(<LogScreen />);

    const input = screen.getByPlaceholderText('Log a set...');
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
    });
  });

  it('keeps both entries when a second line is submitted before the first network round-trip resolves', async () => {
    // Each resolveLine call gets its own pending promise so we can control
    // exactly when the "network" responds, and resolve them in reverse
    // order to prove this doesn't depend on requests settling in submission
    // order.
    let resolveFirst!: (value: { resolvedTokens: never[]; unresolvedTokens: never[] }) => void;
    let resolveSecond!: (value: { resolvedTokens: never[]; unresolvedTokens: never[] }) => void;
    const firstResponse = new Promise<{ resolvedTokens: never[]; unresolvedTokens: never[] }>((res) => {
      resolveFirst = res;
    });
    const secondResponse = new Promise<{ resolvedTokens: never[]; unresolvedTokens: never[] }>((res) => {
      resolveSecond = res;
    });
    mockResolveLine.mockImplementationOnce(() => firstResponse).mockImplementationOnce(() => secondResponse);

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');

    // Fire both submissions while the first is still awaiting its network
    // round-trip - this is the "two lines submitted back-to-back" scenario.
    // These are intentionally NOT awaited: handleSubmit is suspended on the
    // unresolved resolveLine promise, so awaiting fireEvent here (which
    // awaits the whole event dispatch) would block until we resolve it
    // below - defeating the point of firing the second submission first.
    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    fireEvent(input, 'submitEditing');

    await fireEvent.changeText(input, 'DB Curl 12kg 10x3');
    fireEvent(input, 'submitEditing');

    // Resolve out of submission order to prove correctness doesn't depend on
    // requests settling in the order they were fired.
    resolveSecond({ resolvedTokens: [], unresolvedTokens: [] });
    resolveFirst({ resolvedTokens: [], unresolvedTokens: [] });

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
      expect(screen.getByText('DB Curl 12kg 10x3')).toBeTruthy();
    });

    let session: Awaited<ReturnType<typeof getLocalSession>>;
    await waitFor(async () => {
      session = await getLocalSession(todayDate());
      expect(session?.entries).toHaveLength(2);
    });

    const rawTexts = session!.entries.map((e) => e.rawText).sort();
    expect(rawTexts).toEqual(['BB RDL 40kg 8x3', 'DB Curl 12kg 10x3'].sort());
    expect(new Set(session!.entries.map((e) => e.order)).size).toBe(2);
  });
});
