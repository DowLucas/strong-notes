import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import LogScreen from '../../app/(tabs)/index';
import { resolveLine } from '../../src/api/client';
import { resetDbForTests } from '../../src/db/client';

jest.mock('../../src/api/client', () => ({
  resolveLine: jest.fn(),
}));

const mockResolveLine = resolveLine as jest.Mock;

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
});
