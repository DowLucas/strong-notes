import '@/lib/i18n';
import { Platform } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import SignIn from '../../app/(auth)/sign-in';
import { useAuth } from '@/lib/auth';
import { showAlert } from '@/lib/app-alert';

jest.mock('@/lib/auth');
jest.mock('@/lib/app-alert', () => ({ showAlert: jest.fn().mockResolvedValue('ok') }));
jest.mock('@/lib/storage', () => ({
  loadLastEmail: jest.fn().mockResolvedValue(null),
  saveLastEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'raw-nonce'),
  digestStringAsync: jest.fn().mockResolvedValue('hashed-nonce'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-apple-authentication', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    isAvailableAsync: jest.fn().mockResolvedValue(true),
    signInAsync: jest.fn(),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0 },
    AppleAuthenticationButtonStyle: { BLACK: 2 },
    AppleAuthenticationButton: (props: { onPress: () => void; testID?: string }) =>
      React.createElement(Pressable, { onPress: props.onPress, testID: props.testID }),
  };
});

const signInAsync = AppleAuthentication.signInAsync as jest.Mock;
const signInWithApple = jest.fn().mockResolvedValue(undefined);

function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('ios');
  (AppleAuthentication.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  (useAuth as jest.Mock).mockReturnValue({
    api: { requestMagicLink: jest.fn() },
    signInWithToken: jest.fn(),
    signInWithApple,
    signedOutReason: null,
  });
});

describe('Sign in with Apple', () => {
  it('sends the identity token, raw nonce and full name on a successful sign-in', async () => {
    signInAsync.mockResolvedValue({
      identityToken: 'apple-jwt',
      fullName: { givenName: 'Ada', familyName: 'Lovelace' },
    });

    await render(<SignIn />);
    const button = await screen.findByTestId('apple-sign-in');
    await fireEvent.press(button);

    await waitFor(() => expect(signInWithApple).toHaveBeenCalledWith('apple-jwt', 'raw-nonce', 'Ada Lovelace'));
    expect(signInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'hashed-nonce', requestedScopes: [0, 1] }),
    );
    expect(showAlert).not.toHaveBeenCalled();
  });

  it('omits the name when Apple does not return one (repeat sign-in)', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'apple-jwt', fullName: null });

    await render(<SignIn />);
    await fireEvent.press(await screen.findByTestId('apple-sign-in'));

    await waitFor(() => expect(signInWithApple).toHaveBeenCalledWith('apple-jwt', 'raw-nonce', undefined));
  });

  it('stays quiet when the user cancels the Apple sheet', async () => {
    signInAsync.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }));

    await render(<SignIn />);
    await fireEvent.press(await screen.findByTestId('apple-sign-in'));

    await waitFor(() => expect(signInAsync).toHaveBeenCalled());
    expect(signInWithApple).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
  });

  it('shows the error alert when the exchange fails', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'apple-jwt', fullName: null });
    signInWithApple.mockRejectedValueOnce(new Error('boom'));

    await render(<SignIn />);
    await fireEvent.press(await screen.findByTestId('apple-sign-in'));

    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sign in with Apple failed' })),
    );
  });

  it('does not render the Apple button on Android', async () => {
    setPlatform('android');

    await render(<SignIn />);
    // Let the availability effect settle; it must not even be consulted.
    await waitFor(() => expect(screen.getByText('Email me a sign-in code')).toBeTruthy());
    expect(AppleAuthentication.isAvailableAsync).not.toHaveBeenCalled();
    expect(screen.queryByTestId('apple-sign-in')).toBeNull();
  });
});
