import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ContentContainer } from '@/components/ContentContainer';
import { showAlert } from '@/lib/app-alert';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { colors, radii, spacing, typography } from '@/lib/theme';

type Stage = 'email' | 'token';

/** Error code `AppleAuthentication.signInAsync` rejects with when the user dismisses the sheet. */
const APPLE_CANCELED = 'ERR_REQUEST_CANCELED';

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

export default function SignIn() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { api, signInWithToken, signInWithApple } = useAuth();
  const appleAvailable = useAppleSignInAvailable();

  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendLink() {
    if (busy || !email.trim()) return;
    setBusy(true);
    try {
      const res = await api.requestMagicLink(email.trim());
      // DevMode returns the token inline — pre-fill it so dev sign-in is
      // a single tap with no email round-trip.
      if (res.token) setToken(res.token);
      setStage('token');
    } catch {
      await showAlert({
        title: t('signIn.couldNotSend'),
        message: t('signIn.couldNotSendBody'),
      });
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
      const expired = err instanceof ApiError && (err.status === 400 || err.status === 401);
      await showAlert({
        title: t('signIn.verifyFailed'),
        message: expired ? t('signIn.verifyFailedBody') : t('errors.generic'),
      });
    } finally {
      setBusy(false);
    }
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
          <Text variant="monoLabel" color={colors.lead} style={styles.eyebrow}>
            {t('signIn.eyebrow')}
          </Text>
          <Text variant="displayM" style={styles.headline}>
            {t('signIn.headline')}
          </Text>

          {stage === 'email' ? (
            <>
              <Text variant="body" color={colors.lead} style={styles.subtitle}>
                {t('signIn.subtitle')}
              </Text>
              <View style={styles.card}>
                <Field
                  label={t('signIn.emailLabel')}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('signIn.emailPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
              </View>
              <Button onPress={sendLink} disabled={busy || !email.trim()}>
                {busy ? t('signIn.sending') : t('signIn.sendLink')}
              </Button>
              {appleAvailable && (
                <>
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text variant="monoLabel" color={colors.lead}>
                      {t('signIn.or')}
                    </Text>
                    <View style={styles.dividerLine} />
                  </View>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                    buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={radii.md}
                    style={styles.appleButton}
                    onPress={signInApple}
                    testID="apple-sign-in"
                  />
                </>
              )}
            </>
          ) : (
            <>
              <Text variant="body" color={colors.lead} style={styles.subtitle}>
                {t('signIn.checkEmailBody', { email: email.trim() })}
              </Text>
              <View style={styles.card}>
                <Field
                  label={t('signIn.tokenLabel')}
                  value={token}
                  onChangeText={setToken}
                  placeholder={t('signIn.tokenPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Button onPress={verify} disabled={busy || !token.trim()}>
                {busy ? t('signIn.verifying') : t('signIn.verify')}
              </Button>
              <Button kind="ghost" onPress={() => setStage('email')} disabled={busy}>
                {t('common.back')}
              </Button>
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
});
