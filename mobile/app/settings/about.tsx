import { View, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { ContentContainer } from '@/components/ContentContainer';
import { colors, spacing, typography } from '@/lib/theme';

const SOURCE_URL = 'https://github.com/DowLucas/app-scaffold';

export default function About() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '—';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar
        title={t('settings.about.title')}
        left={<IconButton icon="chevron-left" label={t('common.back')} onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          <Text variant="displayM" style={styles.name}>{t('app.name')}</Text>
          <Text variant="body" color={colors.lead} style={styles.tagline}>
            {t('settings.about.tagline')}
          </Text>
          <Text variant="monoCaption" color={colors.lead} style={styles.version}>
            {t('settings.about.version', { version })}
          </Text>

          <View style={styles.list}>
            <TouchableOpacity style={styles.row} onPress={() => void Linking.openURL(SOURCE_URL)} activeOpacity={0.7}>
              <Text style={styles.rowLabel}>{t('settings.about.repoLabel')}</Text>
              <Feather name="external-link" size={18} color={colors.lead} />
            </TouchableOpacity>
          </View>
        </ContentContainer>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: spacing.s5, paddingTop: spacing.s6, gap: spacing.s2 },
  name: { ...typography.displayM, letterSpacing: -0.6 },
  tagline: { lineHeight: 22 },
  version: { marginTop: spacing.s2, letterSpacing: 0.3 },
  list: {
    marginTop: spacing.s6,
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  rowLabel: { ...typography.body, color: colors.graphite },
});
