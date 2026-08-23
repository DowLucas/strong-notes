import '@/lib/i18n';
import { Platform } from 'react-native';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import SignIn, { isPlausibleEmail } from '../../app/(auth)/sign-in';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { loadLastEmail, saveLastEmail } from '@/lib/storage';

jest.mock('@/lib/auth');
jest.mock('@/lib/app-alert', () => ({ showAlert: jest.fn().mockResolvedValue('ok') }));
jest.mock('@/lib/storage', () => ({
  loadLastEmail: jest.fn().mockResolvedValue(null),
  saveLastEmail: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(() => ({})) }));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationButtonType: { SIGN_IN: 0 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
  AppleAuthenticationButton: () => null,
}));

const requestMagicLink = jest.fn();
const signInWithToken = jest.fn();

function mockAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    api: { requestMagicLink },
    signInWithToken,
    signInWithApple: jest.fn(),
    signedOutReason: null,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  (loadLastEmail as jest.Mock).mockResolvedValue(null);
  requestMagicLink.mockResolvedValue({ ok: true });
  mockAuth();
});

describe('isPlausibleEmail', () => {
  it.each(['a@b.co', 'lucas.dow@fidify.se', ' x@y.org '])('accepts %s', (v) => {
    expect(isPlausibleEmail(v)).toBe(true);
  });
  it.each(['', 'lucas', 'lucas@', '@x.se', 'a b@c.se', 'a@b'])('rejects %s', (v) => {
    expect(isPlausibleEmail(v)).toBe(false);
  });
});

describe('SignIn', () => {
  it('shows the value proposition and the email CTA', async () => {
    await render(<SignIn />);
    expect(screen.getByText('Your gym log, as notes.')).toBeTruthy();
    expect(screen.getByText('Email me a sign-in code')).toBeTruthy();
  });

  it('shows an inline error for a malformed email and does not call the API', async () => {
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email-field'), 'not-an-email');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));

    expect(await screen.findByText('Enter a valid email address, like you@example.com.')).toBeTruthy();
    expect(requestMagicLink).not.toHaveBeenCalled();

    // Typing again clears the error.
    await fireEvent.changeText(screen.getByTestId('email-field'), 'me@example.com');
    expect(screen.queryByText('Enter a valid email address, like you@example.com.')).toBeNull();
  });

  it('sends the code, remembers the email and moves to the code stage', async () => {
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email-field'), 'Me@Example.com');
    await fireEvent(screen.getByTestId('email-field'), 'submitEditing');

    await waitFor(() => expect(requestMagicLink).toHaveBeenCalledWith('Me@Example.com'));
    expect(await screen.findByText('Check your email')).toBeTruthy();
    expect(screen.getByText(/We sent a sign-in code to Me@Example.com/)).toBeTruthy();
    expect(saveLastEmail).toHaveBeenCalledWith('Me@Example.com');
  });

  it('maps a network failure on send to the network copy, inline', async () => {
    requestMagicLink.mockRejectedValueOnce(new TypeError('Network request failed'));
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email-field'), 'me@example.com');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));

    expect(
      await screen.findByText("Couldn't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    expect(screen.queryByText('Check your email')).toBeNull();
  });

  it('shows the invalid/expired copy inline when verification is rejected', async () => {
    signInWithToken.mockRejectedValueOnce(new ApiError(401, 'bad token'));
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email-field'), 'me@example.com');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));
    await screen.findByText('Check your email');

    await fireEvent.changeText(screen.getByTestId('code-field'), 'abc');
    await fireEvent.press(screen.getByText('Verify and sign in'));

    expect(
      await screen.findByText('That code is invalid or expired. Request a new code and try again.'),
    ).toBeTruthy();
    expect(signInWithToken).toHaveBeenCalledWith('abc');
  });

  it('disables "Resend code" with a countdown, then re-enables it after the cooldown', async () => {
    jest.useFakeTimers();
    try {
      await render(<SignIn />);
      await fireEvent.changeText(screen.getByTestId('email-field'), 'me@example.com');
      await fireEvent.press(screen.getByText('Email me a sign-in code'));
      await screen.findByText('Check your email');

      const resend = screen.getByLabelText('Resend code in 30s');
      expect(resend.props.accessibilityState.disabled).toBe(true);
      requestMagicLink.mockClear();
      await fireEvent.press(resend);
      expect(requestMagicLink).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });

      const enabled = await screen.findByLabelText('Resend code');
      expect(enabled.props.accessibilityState.disabled).toBe(false);
      await fireEvent.press(enabled);
      await waitFor(() => expect(requestMagicLink).toHaveBeenCalledWith('me@example.com'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('"Use a different email" returns to the email stage', async () => {
    await render(<SignIn />);
    await fireEvent.changeText(screen.getByTestId('email-field'), 'me@example.com');
    await fireEvent.press(screen.getByText('Email me a sign-in code'));
    await screen.findByText('Check your email');

    await fireEvent.press(screen.getByText('Use a different email'));
    expect(await screen.findByText('Your gym log, as notes.')).toBeTruthy();
    expect(screen.getByTestId('email-field').props.value).toBe('me@example.com');
  });

  it('pre-fills the last used email', async () => {
    (loadLastEmail as jest.Mock).mockResolvedValue('last@example.com');
    await render(<SignIn />);
    await waitFor(() => expect(screen.getByTestId('email-field').props.value).toBe('last@example.com'));
  });

  it('explains an expired session with an inline banner', async () => {
    mockAuth({ signedOutReason: 'expired' });
    await render(<SignIn />);
    expect(screen.getByTestId('expired-banner')).toBeTruthy();
    expect(screen.getByText('Your session has expired. Please sign in again.')).toBeTruthy();
    expect(screen.getByText('Your local log is safe.')).toBeTruthy();
  });

  it('also reads the expiry reason from the route param', async () => {
    const { useLocalSearchParams } = jest.requireMock('expo-router');
    useLocalSearchParams.mockReturnValueOnce({ reason: 'expired' });
    await render(<SignIn />);
    expect(screen.getByTestId('expired-banner')).toBeTruthy();
  });
});
