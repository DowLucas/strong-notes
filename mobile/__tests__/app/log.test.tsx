import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { getLocalSession } from '@/src/db/sessionsRepo';

jest.mock('@/lib/auth');

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const mockResolveLine = jest.fn();

beforeEach(() => {
  resetDbForTests();
  mockResolveLine.mockReset().mockResolvedValue({ resolvedTokens: [], unresolvedTokens: [] });
  (useAuth as jest.Mock).mockReturnValue({ api: { resolveLine: mockResolveLine } });
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
    let resolveFirst!: (value: { resolvedTokens: never[]; unresolvedTokens: never[] }) => void;
    let resolveSecond!: (value: { resolvedTokens: never[]; unresolvedTokens: never[] }) => void;
    const firstResponse = new Promise((res) => { resolveFirst = res as typeof resolveFirst; });
    const secondResponse = new Promise((res) => { resolveSecond = res as typeof resolveSecond; });
    mockResolveLine.mockImplementationOnce(() => firstResponse).mockImplementationOnce(() => secondResponse);

    await render(<LogScreen />);
    const input = screen.getByPlaceholderText('Log a set...');

    await fireEvent.changeText(input, 'BB RDL 40kg 8x3');
    fireEvent(input, 'submitEditing');
    await fireEvent.changeText(input, 'DB Curl 12kg 10x3');
    fireEvent(input, 'submitEditing');

    resolveSecond({ resolvedTokens: [], unresolvedTokens: [] });
    resolveFirst({ resolvedTokens: [], unresolvedTokens: [] });

    await waitFor(() => {
      expect(screen.getByText('BB RDL 40kg 8x3')).toBeTruthy();
      expect(screen.getByText('DB Curl 12kg 10x3')).toBeTruthy();
    });

    const session = await getLocalSession(todayDate());
    expect(session?.entries).toHaveLength(2);
  });
});
