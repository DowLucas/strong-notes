import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Feather } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ContentContainer } from '@/components/ContentContainer';
import { showAlert } from '@/lib/app-alert';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { useEnglishT } from '@/lib/i18n';
import { loadLastEmail, saveLastEmail } from '@/lib/storage';
import { colors, radii, spacing, typography } from '@/lib/theme';

type Stage = 'email' | 'token';

/** Error code `AppleAuthentication.signInAsync` rejects with when the user dismisses the sheet. */
const APPLE_CANCELED = 'ERR_REQUEST_CANCELED';

/** Seconds the user must wait before asking for another code. */
export const RESEND_COOLDOWN_S = 30;

/** Cheap shape check — the server does the real validation; this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * True once we know the device can present the native Apple sign-in sheet.
 * Only iOS ever qualifies; Android/web resolve to false without touching the
 * native module.
 */
function useAppleSignInAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (active) setAvailable(ok);
      })
      .catch(() => {
        /* treat as unavailable */
      });
    return () => {
      active = false;
    };
  }, []);
  return available;
}

/** Seconds left until `until` (epoch ms), ticking once a second; 0 when passed. */
function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until == null || until <= Date.now()) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (until == null) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export default function SignIn() {
  // English regardless of device locale: the user hasn't confirmed they can
  // read the detected language yet, and a sign-in screen they can't read is
  // a dead end.
  const t = useEnglishT();
  const insets = useSafeAreaInsets();
  const { api, signInWithToken, signInWithApple, signedOutReason } = useAuth();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const appleAvailable = useAppleSignInAvailable();
  const expired = signedOutReason === 'expired' || reason === 'expired';

  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [devHint, setDevHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const resendIn = useCountdown(resendAt);
  const userTyped = useRef(false);

  // Pre-fill the last address used — most useful right after an expiry.
  useEffect(() => {
    let active = true;
    loadLastEmail().then((last) => {
      if (active && last && !userTyped.current) setEmail(last);
    });
    return () => {
      active = false;
    };
  }, []);

  function changeEmail(value: string) {
    userTyped.current = true;
    setEmail(value);
    if (emailError) setEmailError(null);
  }

  function changeToken(value: string) {
    setToken(value);
    if (tokenError) setTokenError(null);
  }

  function describe(err: unknown, fallback: string): string {
    if (err instanceof TypeError) return t('errors.network');
    return fallback;
  }

  async function sendCode() {
    if (busy) return;
    const address = email.trim();
    if (!isPlausibleEmail(address)) {
      setEmailError(t('signIn.emailInvalid'));
      return;
    }
    setBusy(true);
    setEmailError(null);
    try {
      const res = await api.requestMagicLink(address);
      void saveLastEmail(address);
      // DevMode returns the token inline — pre-fill it so dev sign-in is
      // a single tap with no email round-trip.
      if (res.token) setToken(res.token);
      setDevHint(!!res.token);
      setTokenError(null);
      setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
      setStage('token');
    } catch (err) {
      setEmailError(describe(err, t('signIn.couldNotSendBody')));
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    if (busy || resendIn > 0) return;
    setBusy(true);
    try {
      const res = await api.requestMagicLink(email.trim());
      if (res.token) setToken(res.token);
      setTokenError(null);
      setResendAt(Date.now() + RESEND_COOLDOWN_S * 1000);
    } catch (err) {
      setTokenError(describe(err, t('signIn.couldNotSendBody')));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || !token.trim()) return;
    setBusy(true);
    try {
      await signInWithToken(token.trim());
      // The (auth) layout redirects to (tabs) once a session exists.
    } catch (err) {
      const rejected = err instanceof ApiError && (err.status === 400 || err.status === 401);
      setTokenError(rejected ? t('signIn.verifyFailedBody') : describe(err, t('errors.generic')));
    } finally {
      setBusy(false);
    }
  }

  function useDifferentEmail() {
    setToken('');
    setTokenError(null);
    setDevHint(false);
    setStage('email');
  }

  async function signInApple() {
    if (busy) return;
    try {
      // Apple wants the SHA-256 of the nonce in the identity token; the
      // backend gets the raw value and re-hashes it to verify.
      const nonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      if (!credential.identityToken) throw new Error('missing identity token');
      // Apple only returns the name on the very first sign-in.
      const name =
        [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ') ||
        undefined;
      setBusy(true);
      await signInWithApple(credential.identityToken, nonce, name);
    } catch (err) {
      // The user dismissed the system sheet — nothing to report.
      if ((err as { code?: string } | null)?.code === APPLE_CANCELED) return;
      await showAlert({ title: t('signIn.appleFailed'), message: t('errors.generic') });
    } finally {
      setBusy(false);
    }
  }

  const resendLabel = resendIn > 0 ? t('signIn.resendIn', { seconds: resendIn }) : t('signIn.resend');

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <ContentContainer style={styles.content}>
          {stage === 'email' ? (
            <>
              <Text variant="monoLabel" color={colors.lead} style={styles.eyebrow}>
                {t('signIn.eyebrow')}
              </Text>
              <Text variant="displayM" style={styles.headline} accessibilityRole="header">
                {t('signIn.headline')}
              </Text>
              <Text variant="body" color={colors.lead} style={styles.subtitle}>
                {t('signIn.subtitle')}
              </Text>

              {expired ? (
                <View style={styles.banner} accessibilityRole="alert" testID="expired-banner">
                  <Feather name="info" size={18} color={colors.graphite} importantForAccessibility="no" />
                  <View style={styles.bannerText}>
                    <Text variant="bodyEmphasis">{t('errors.unauthorized')}</Text>
                    <Text variant="bodyS" color={colors.lead}>
                      {t('signIn.localLogSafe')}
                    </Text>
                  </View>
                </View>
              ) : null}

              {appleAvailable && (
                <>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={radii.md}
                    style={styles.appleButton}
                    onPress={signInApple}
                    testID="apple-sign-in"
                  />
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text variant="monoLabel" color={colors.lead}>
                      {t('signIn.orEmail')}
                    </Text>
                    <View style={styles.dividerLine} />
                  </View>
                </>
              )}

              <View style={styles.card}>
                <Field
                  label={t('signIn.emailLabel')}
                  value={email}
                  onChangeText={changeEmail}
                  placeholder={t('signIn.emailPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  returnKeyType="send"
                  onSubmitEditing={() => void sendCode()}
                  error={emailError}
                  testID="email-field"
                />
              </View>
              <Button
                kind="positive"
                onPress={() => void sendCode()}
                disabled={busy || !email.trim()}
                busy={busy}
                accessibilityHint={t('signIn.sendCodeHint')}
              >
                {busy ? t('signIn.sending') : t('signIn.sendCode')}
              </Button>
            </>
          ) : (
            <>
              <Text variant="monoLabel" color={colors.lead} style={styles.eyebrow}>
                {t('signIn.eyebrow')}
              </Text>
              <Text variant="displayM" style={styles.headline} accessibilityRole="header">
                {t('signIn.checkEmail')}
              </Text>
              <Text variant="body" color={colors.lead} style={styles.subtitle}>
                {t('signIn.checkEmailBody', { email: email.trim() })}
              </Text>
              {devHint ? (
                <Text variant="monoCaption" color={colors.moss} style={styles.subtitle}>
                  {t('signIn.devHint')}
                </Text>
              ) : null}
              <View style={styles.card}>
                <Field
                  label={t('signIn.tokenLabel')}
                  value={token}
                  onChangeText={changeToken}
                  placeholder={t('signIn.tokenPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  returnKeyType="go"
                  onSubmitEditing={() => void verify()}
                  error={tokenError}
                  testID="code-field"
                />
              </View>
              <Button
                kind="positive"
                onPress={() => void verify()}
                disabled={busy || !token.trim()}
                busy={busy}
              >
                {busy ? t('signIn.verifying') : t('signIn.verify')}
              </Button>
              <View style={styles.secondaryRow}>
                <Button
                  kind="ghost"
                  onPress={() => void resendCode()}
                  disabled={busy || resendIn > 0}
                  accessibilityLabel={resendLabel}
                  accessibilityHint={t('signIn.resendHint')}
                  style={styles.secondaryButton}
                >
                  {resendLabel}
                </Button>
                <Button
                  kind="ghost"
                  onPress={useDifferentEmail}
                  disabled={busy}
                  accessibilityHint={t('signIn.differentEmailHint')}
                  style={styles.secondaryButton}
                >
                  {t('signIn.differentEmail')}
                </Button>
              </View>
            </>
          )}
        </ContentContainer>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  content: { paddingHorizontal: spacing.s5, paddingVertical: spacing.s6, gap: spacing.s3 },
  eyebrow: { letterSpacing: 0.4 },
  headline: { ...typography.displayM, letterSpacing: -0.6, marginBottom: spacing.s2 },
  subtitle: { lineHeight: 22, marginBottom: spacing.s3 },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s3,
    padding: spacing.s4,
    borderRadius: radii.md,
    backgroundColor: colors.bone,
    marginBottom: spacing.s3,
  },
  bannerText: { flex: 1, gap: 2 },
  card: {
    backgroundColor: colors.bone,
    borderRadius: 10,
    marginBottom: spacing.s4,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s3,
    marginVertical: spacing.s3,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.ruleSoft },
  appleButton: { height: 52, width: '100%' },
  secondaryRow: { flexDirection: 'row', gap: spacing.s2, marginTop: spacing.s2 },
  secondaryButton: { flex: 1, paddingHorizontal: spacing.s2 },
});
