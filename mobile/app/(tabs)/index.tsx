import { View, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { useAuth } from '@/lib/auth';
import { colors, spacing, typography } from '@/lib/theme';

export default function Home() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const user = session?.user;
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('app.name')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <ContentContainer style={styles.content}>
          <Text variant="displayM" style={styles.greeting}>
            {firstName ? t('home.greeting', { name: firstName }) : t('home.greetingFallback')}
          </Text>
          <Text variant="body" color={colors.lead} style={styles.subtitle}>
            {t('home.subtitle')}
          </Text>
          {user?.email ? (
            <Text variant="monoCaption" color={colors.lead} style={styles.email}>
              {t('home.signedInAs', { email: user.email })}
            </Text>
          ) : null}
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.s5, paddingTop: spacing.s6, gap: spacing.s3 },
  greeting: { ...typography.displayM, letterSpacing: -0.6 },
  subtitle: { lineHeight: 22 },
  email: { marginTop: spacing.s3, letterSpacing: 0.3 },
});
