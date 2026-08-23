import '@/lib/i18n';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import DictionaryScreen from '../../app/settings/dictionary';
import { useAuth } from '@/lib/auth';
import { showAlert } from '@/lib/app-alert';
import { resetDbForTests } from '@/src/db/client';
import { cacheAbbreviations, getCachedAbbreviations } from '@/src/db/abbreviationsRepo';
import { syncNow } from '@/src/sync/syncEngine';

jest.mock('@/lib/auth');
jest.mock('@/lib/app-alert', () => ({ showAlert: jest.fn().mockResolvedValue('ok') }));
jest.mock('@/src/sync/syncEngine', () => ({ syncNow: jest.fn().mockResolvedValue({ pushed: 0, pulled: 0, failed: 0 }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const api = {
  confirmAbbreviation: jest.fn(),
  deleteAbbreviation: jest.fn(),
  createAbbreviation: jest.fn(),
  createExercise: jest.fn(),
};

beforeEach(async () => {
  jest.clearAllMocks();
  resetDbForTests();
  (useAuth as jest.Mock).mockReturnValue({ api });
  (showAlert as jest.Mock).mockResolvedValue('ok');
  await cacheAbbreviations([
    { id: '1', token: 'RDL', exerciseId: 'ex-1', exerciseName: 'Romanian deadlift', source: 'BUILT_IN', createdAt: '' },
    { id: '2', token: 'BB', modifierType: 'equipment', modifierValue: 'barbell', source: 'USER_ADDED', createdAt: '' },
    { id: '3', token: 'CRABWALK', exerciseId: 'ex-3', exerciseName: 'Crab walk', source: 'LLM_SUGGESTED_PENDING_CONFIRM', createdAt: '' },
  ]);
});

describe('Dictionary screen', () => {
  it('renders cached rows immediately (suggestions first) and syncs in the background', async () => {
    await render(<DictionaryScreen />);
    expect(await screen.findByText('RDL')).toBeTruthy();
    expect(screen.getByText('Romanian deadlift')).toBeTruthy();
    expect(screen.getByText('barbell (equipment)')).toBeTruthy();
    expect(screen.getByText('Suggested')).toBeTruthy();
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith(api));

    const tokens = screen.getAllByText(/^(RDL|BB|CRABWALK)$/).map((n) => n.props.children);
    expect(tokens).toEqual(['CRABWALK', 'BB', 'RDL']);
  });

  it('filters rows by token or target', async () => {
    await render(<DictionaryScreen />);
    await screen.findByText('RDL');
    await fireEvent.changeText(screen.getByTestId('dictionary-search'), 'barb');
    expect(screen.getByText('BB')).toBeTruthy();
    expect(screen.queryByText('RDL')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('dictionary-search'), 'zzz');
    expect(screen.getByText('No terms match “zzz”.')).toBeTruthy();
  });

  it('confirms a suggested term and updates the local cache', async () => {
    api.confirmAbbreviation.mockResolvedValue({
      id: '3', token: 'CRABWALK', exerciseId: 'ex-3', exerciseName: 'Crab walk', source: 'USER_ADDED', createdAt: '',
    });
    await render(<DictionaryScreen />);
    await fireEvent.press(await screen.findByLabelText('Confirm CRABWALK'));

    await waitFor(() => expect(api.confirmAbbreviation).toHaveBeenCalledWith('3'));
    await waitFor(() => expect(screen.queryByText('Suggested')).toBeNull());
    const cached = await getCachedAbbreviations();
    expect(cached.find((a) => a.id === '3')?.source).toBe('USER_ADDED');
  });

  it('dismisses a suggestion by deleting it (no confirmation)', async () => {
    api.deleteAbbreviation.mockResolvedValue(undefined);
    await render(<DictionaryScreen />);
    await fireEvent.press(await screen.findByLabelText('Dismiss CRABWALK'));

    await waitFor(() => expect(api.deleteAbbreviation).toHaveBeenCalledWith('3'));
    await waitFor(() => expect(screen.queryByText('CRABWALK')).toBeNull());
    expect(showAlert).not.toHaveBeenCalled();
    expect((await getCachedAbbreviations()).map((a) => a.id)).toEqual(expect.not.arrayContaining(['3']));
  });

  it('deletes a term after confirmation and removes it from the cache', async () => {
    api.deleteAbbreviation.mockResolvedValue(undefined);
    (showAlert as jest.Mock).mockResolvedValueOnce('delete');
    await render(<DictionaryScreen />);
    await fireEvent.press(await screen.findByTestId('delete-BB'));

    await waitFor(() => expect(api.deleteAbbreviation).toHaveBeenCalledWith('2'));
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete “BB”?' }));
    await waitFor(() => expect(screen.queryByText('BB')).toBeNull());
    expect((await getCachedAbbreviations()).some((a) => a.id === '2')).toBe(false);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    (showAlert as jest.Mock).mockResolvedValueOnce('cancel');
    await render(<DictionaryScreen />);
    await fireEvent.press(await screen.findByTestId('delete-BB'));
    await waitFor(() => expect(showAlert).toHaveBeenCalled());
    expect(api.deleteAbbreviation).not.toHaveBeenCalled();
    expect(screen.getByText('BB')).toBeTruthy();
  });

  it('adds an exercise shorthand: creates/links the exercise, then the abbreviation', async () => {
    api.createExercise.mockResolvedValue({ id: 'ex-9', name: 'Hip thrust', category: 'COMPOUND', createdAt: '' });
    api.createAbbreviation.mockResolvedValue({ id: '9', token: 'HT', exerciseId: 'ex-9', exerciseName: 'Hip thrust', source: 'USER_ADDED', createdAt: '' });
    await render(<DictionaryScreen />);
    await screen.findByText('RDL');

    await fireEvent.press(screen.getByText('+ Add shorthand'));
    await fireEvent.changeText(screen.getByTestId('add-token'), 'ht');
    await fireEvent.changeText(screen.getByTestId('add-target'), 'Hip thrust');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() => expect(api.createExercise).toHaveBeenCalledWith({ name: 'Hip thrust', muscles: [] }));
    await waitFor(() => expect(api.createAbbreviation).toHaveBeenCalledWith({ token: 'ht', exerciseId: 'ex-9' }));
    expect(await screen.findByText('HT')).toBeTruthy();
    expect(screen.getByText('Hip thrust')).toBeTruthy();
    expect((await getCachedAbbreviations()).some((a) => a.token === 'HT')).toBe(true);
  });

  it('adds an equipment shorthand as a modifier', async () => {
    api.createAbbreviation.mockResolvedValue({ id: '10', token: 'KB', modifierType: 'equipment', modifierValue: 'kettlebell', source: 'USER_ADDED', createdAt: '' });
    await render(<DictionaryScreen />);
    await screen.findByText('RDL');

    await fireEvent.press(screen.getByText('+ Add shorthand'));
    await fireEvent.press(screen.getByTestId('kind-equipment'));
    await fireEvent.changeText(screen.getByTestId('add-token'), 'kb');
    await fireEvent.changeText(screen.getByTestId('add-target'), 'Kettlebell');
    await fireEvent.press(screen.getByText('Save'));

    await waitFor(() =>
      expect(api.createAbbreviation).toHaveBeenCalledWith({ token: 'kb', modifierType: 'equipment', modifierValue: 'kettlebell' }),
    );
    expect(api.createExercise).not.toHaveBeenCalled();
    expect(await screen.findByText('kettlebell (equipment)')).toBeTruthy();
  });

  it('shows an inline error when adding fails', async () => {
    api.createExercise.mockRejectedValue(new Error('500'));
    await render(<DictionaryScreen />);
    await screen.findByText('RDL');
    await fireEvent.press(screen.getByText('+ Add shorthand'));
    await fireEvent.changeText(screen.getByTestId('add-token'), 'x');
    await fireEvent.changeText(screen.getByTestId('add-target'), 'Y');
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText("Couldn't save the shorthand. Please try again.")).toBeTruthy();
  });

  it('explains the dictionary when it is empty', async () => {
    resetDbForTests();
    await render(<DictionaryScreen />);
    expect(await screen.findByText('No shorthand yet')).toBeTruthy();
  });
});
