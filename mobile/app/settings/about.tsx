import { useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { ContentContainer } from '@/components/ContentContainer';
import { ListGroup, ListRow } from '@/components/ListRow';
import { copyToClipboard } from '@/lib/clipboard';
import { colors, spacing, typography } from '@/lib/theme';

export const SOURCE_URL = 'https://github.com/DowLucas/strong-notes';
export const PRIVACY_URL = 'https://strong-notes.lurkhuset.com/privacy';
export const TERMS_URL = 'https://strong-notes.lurkhuset.com/terms';
export const SUPPORT_EMAIL = 'lucas.dow@fidify.se';

/** "1.0.0 (42)" — app version plus native build number when known. */
export function versionString(): string {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '—';
  const build = Application.nativeBuildVersion;
  return build ? `${version} (${build})` : version;
}

export default function About() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const version = versionString();

  // "Version copied" reverts to the version after a moment.
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  function copyVersion() {
    copyToClipboard(`${t('app.name')} ${version}`);
    setCopied(true);
  }

  const open = (url: string) => () => void Linking.openURL(url);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar
        title={t('settings.about.title')}
        left={<IconButton icon="chevron-left" label={t('common.back')} onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          <View style={styles.hero}>
            <Text variant="displayM" style={styles.name} accessibilityRole="header">
              {t('app.name')}
            </Text>
            <Text variant="body" color={colors.lead} style={styles.tagline}>
              {t('settings.about.tagline')}
            </Text>
          </View>

          <ListGroup>
            <ListRow
              label={t('settings.about.privacy')}
              hint={t('settings.about.opensBrowserHint')}
              trailing="external"
              onPress={open(PRIVACY_URL)}
            />
            <ListRow
              label={t('settings.about.terms')}
              hint={t('settings.about.opensBrowserHint')}
              trailing="external"
              onPress={open(TERMS_URL)}
            />
            <ListRow
              label={t('settings.about.contactSupport')}
              value={SUPPORT_EMAIL}
              hint={t('settings.about.contactSupportHint')}
              trailing="external"
              onPress={open(`mailto:${SUPPORT_EMAIL}`)}
            />
            <ListRow
              label={t('settings.about.repoLabel')}
              hint={t('settings.about.opensBrowserHint')}
              trailing="external"
              onPress={open(SOURCE_URL)}
            />
            <ListRow
              label={t('settings.about.versionLabel')}
              value={copied ? t('settings.about.versionCopied') : version}
              hint={t('settings.about.copyVersionHint')}
              trailing="none"
              onPress={copyVersion}
              testID="version-row"
            />
          </ListGroup>
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingTop: spacing.s6 },
  hero: { paddingHorizontal: spacing.s5, gap: spacing.s2, marginBottom: spacing.s6 },
  name: { ...typography.displayM, letterSpacing: -0.6 },
  tagline: { lineHeight: 22 },
});
