import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import YouScreen from '../../app/(tabs)/you';
import { useAuth } from '@/lib/auth';
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations } from '@/src/db/abbreviationsRepo';

jest.mock('@/lib/auth');
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }) }));

beforeEach(async () => {
  resetDbForTests();
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN', createdAt: '' },
    { id: '2', token: 'CRABWALK', source: 'LLM_SUGGESTED_PENDING_CONFIRM', createdAt: '' },
  ]);
});

describe('YouScreen abbreviation dictionary', () => {
  it('lists cached abbreviations and confirms a pending one', async () => {
    const confirmAbbreviation = jest.fn().mockResolvedValue({});
    (useAuth as jest.Mock).mockReturnValue({
      session: { user: { id: 'u1', email: 'test@example.com', name: 'Test' } },
      api: { confirmAbbreviation, logout: jest.fn(), avatarImageSource: jest.fn(() => null) },
      signOut: jest.fn(),
    });

    await render(<YouScreen />);

    await waitFor(() => {
      expect(screen.getByText('RDL')).toBeTruthy();
      expect(screen.getByText('CRABWALK')).toBeTruthy();
    });

    await fireEvent.press(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(confirmAbbreviation).toHaveBeenCalledWith('2');
    });
  });
});
