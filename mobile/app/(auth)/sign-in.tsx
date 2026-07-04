import { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ContentContainer } from '@/components/ContentContainer';
import { showAlert } from '@/lib/app-alert';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { colors, spacing, typography } from '@/lib/theme';

type Stage = 'email' | 'token';

export default function SignIn() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { api, signInWithToken } = useAuth();

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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
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
    </View>
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
});
