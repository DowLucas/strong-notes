import '@/lib/i18n';
import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import About, { PRIVACY_URL, SUPPORT_EMAIL } from '../../app/settings/about';
import { copyToClipboard } from '@/lib/clipboard';

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('@/lib/clipboard', () => ({ copyToClipboard: jest.fn() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.3', nativeBuildVersion: '42' }));

describe('About', () => {
  it('shows the brand, tagline and the support rows', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<About />);
    expect(screen.getByText('Strong Notes')).toBeTruthy();
    expect(screen.getByText("Log workouts as plain text. We'll work out the rest.")).toBeTruthy();

    await fireEvent.press(screen.getByText('Privacy policy'));
    expect(open).toHaveBeenCalledWith(PRIVACY_URL);
    await fireEvent.press(screen.getByText('Contact support'));
    expect(open).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`);
    await fireEvent.press(screen.getByText('View source on GitHub'));
    expect(open).toHaveBeenCalledWith('https://github.com/DowLucas/strong-notes');
  });

  it('shows version + build and copies it on tap', async () => {
    await render(<About />);
    expect(screen.getByText('1.2.3 (42)')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('version-row'));
    expect(copyToClipboard).toHaveBeenCalledWith('Strong Notes 1.2.3 (42)');
    expect(screen.getByText('Version copied')).toBeTruthy();
  });
});
