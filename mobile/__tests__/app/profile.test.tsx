import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../../app/(tabs)/profile';
import { resetDbForTests } from '../../src/db/client';
import { cacheAbbreviations } from '../../src/db/abbreviationsRepo';
import { confirmAbbreviation } from '../../src/api/client';

jest.mock('../../src/api/client', () => ({
  confirmAbbreviation: jest.fn().mockResolvedValue({}),
  listAbbreviations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/sync/syncEngine', () => ({
  syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0 }),
}));

beforeEach(async () => {
  resetDbForTests();
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', source: 'BUILT_IN' },
    { id: '2', token: 'CRABWALK', source: 'LLM_SUGGESTED_PENDING_CONFIRM' },
  ]);
});

describe('ProfileScreen', () => {
  it('lists cached abbreviations and confirms a pending one', async () => {
    await render(<ProfileScreen />);

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
