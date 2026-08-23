import { useCallback, useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { formatDistanceToNow } from 'date-fns';
import { Text } from '@/components/Text';
import { Avatar } from '@/components/Avatar';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { ActionSheet, type ActionSheetOption } from '@/components/ActionSheet';
import { LanguagePicker } from '@/components/LanguagePicker';
import { ListGroup, ListRow, ListSectionHeader } from '@/components/ListRow';
import { showAlert } from '@/lib/app-alert';
import { isPopupJustClosed } from '@/lib/popup-guard';
import { useAuth } from '@/lib/auth';
import { ApiError, type AvatarMimeType } from '@/lib/api';
import {
  setLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@/lib/i18n';
import { colors, spacing, typography } from '@/lib/theme';
import { getCachedAbbreviations } from '@/src/db/abbreviationsRepo';
import { seedPriorSessions } from '@/src/db/devSeed';
import { getLastSessionForExercise, listUnsyncedSessions } from '@/src/db/sessionsRepo';
import { syncNow } from '@/src/sync/syncEngine';
import { useSyncStatus } from '@/src/sync/syncStatus';

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export default function You() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session, api, refreshMe, signOut } = useAuth();
  const sync = useSyncStatus();

  const [avatarSheet, setAvatarSheet] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [termCount, setTermCount] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshLocalCounts = useCallback(async () => {
    const [terms, unsynced] = await Promise.all([getCachedAbbreviations(), listUnsyncedSessions()]);
    setTermCount(terms.length);
    setPendingCount(unsynced.length);
  }, []);

  // Re-read on every focus: the dictionary screen and the Log tab both change
  // these counts behind our back.
  useFocusEffect(
    useCallback(() => {
      void refreshLocalCounts();
    }, [refreshLocalCounts]),
  );

  async function syncNowTapped() {
    if (sync.running) return;
    try {
      await syncNow(api);
    } catch {
      // The status store carries the error; the row shows it.
    } finally {
      await refreshLocalCounts();
    }
  }

  const user = session?.user;
  const token = session?.token ?? null;
  const avatarSource = user ? api.avatarImageSource(user, token) : null;
  const hasAvatar = !!user?.avatar_object_url;
  const selectedLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language)
    ? (i18n.language as SupportedLanguage)
    : null;
  const showLanguageRow = SUPPORTED_LANGUAGES.length > 1;

  function inferMime(asset: ImagePicker.ImagePickerAsset): AvatarMimeType {
    const m = (asset as { mimeType?: string }).mimeType?.toLowerCase();
    if (m === 'image/png') return 'image/png';
    if (m === 'image/webp') return 'image/webp';
    // allowsEditing re-encodes to JPEG on both platforms; safe default.
    return 'image/jpeg';
  }

  async function uploadPicked(asset: ImagePicker.ImagePickerAsset | undefined) {
    if (!asset?.base64) return;
    setUploading(true);
    try {
      await api.uploadAvatar(asset.base64, inferMime(asset));
      await refreshMe();
    } catch (e) {
      if (e instanceof ApiError && e.status === 413) {
        await showAlert({ title: t('you.avatar.tooLargeTitle'), message: t('you.avatar.tooLargeBody') });
      } else {
        await showAlert({ title: t('you.avatar.uploadFailedTitle'), message: t('you.avatar.uploadFailedBody') });
      }
    } finally {
      setUploading(false);
    }
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      await showAlert({ title: t('you.avatar.permissionTitle'), message: t('you.avatar.permissionBody') });
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
      base64: true,
      exif: false,
    });
    if (picked.canceled) return;
    await uploadPicked(picked.assets?.[0]);
  }

  async function removeAvatar() {
    const r = await showAlert({
      title: t('you.avatar.removeConfirmTitle'),
      message: t('you.avatar.removeConfirmBody'),
      buttons: [
        { key: 'cancel', label: t('common.cancel'), style: 'cancel' },
        { key: 'remove', label: t('you.avatar.remove'), style: 'destructive' },
      ],
    });
    if (r !== 'remove') return;
    setUploading(true);
    try {
      await api.deleteAvatar();
      await refreshMe();
    } catch {
      await showAlert({ title: t('you.avatar.uploadFailedTitle'), message: t('you.avatar.uploadFailedBody') });
    } finally {
      setUploading(false);
    }
  }

  function openAvatarSheet() {
    if (isPopupJustClosed()) return;
    setAvatarSheet(true);
  }

  const avatarOptions: ActionSheetOption[] = [
    { label: t('you.avatar.choosePhoto'), onPress: () => void pickFromLibrary() },
    ...(hasAvatar
      ? [{ label: t('you.avatar.remove'), onPress: () => void removeAvatar(), destructive: true }]
      : []),
  ];

  // Dev-only: seed local prior sessions so the Log editor's prior-stats hint is
  // testable on a fresh install. Reads the dictionary read-only (a full sync
  // would replace the seeded dictionary with the server's).
  async function handleSeedPriorSessions() {
    try {
      const res = await seedPriorSessions();
      const abbrs = await getCachedAbbreviations();
      setTermCount(abbrs.length);

      // Verify the whole chain on-device so we can see where it breaks: pick a
      // token with an exercise id and confirm history exists under that id.
      const first = abbrs.find((a) => a.exerciseId);
      const today = new Date().toISOString().slice(0, 10);
      let diag: string;
      if (!first?.exerciseId) {
        diag = '⚠️ Dictionary has no exercises — sync first, then re-seed.';
      } else {
        const h = await getLastSessionForExercise(first.exerciseId, today);
        diag = h
          ? `✅ "${first.token}" → history OK (${h.entries.length} sets, ${h.date}).`
          : `❌ "${first.token}" → NO history under ${first.exerciseId.slice(0, 8)}…`;
      }

      const example = res.tokens[0] ?? 'rdl';
      await showAlert({
        title: 'Seeded prior sessions',
        message:
          `Tokens: ${res.tokens.join(', ')}\n${diag}\n\n` +
          `Now HARD-RELOAD the app, then on the Log tab type:\n  ${example} 40kgx8\n\n` +
          `It should turn blue; caret on the line shows last session's stats.`,
      });
    } catch (e) {
      await showAlert({ title: 'Seed failed', message: String(e) });
    }
  }

  async function confirmSignOut() {
    if (isPopupJustClosed()) return;
    const r = await showAlert({
      title: t('you.signOutConfirmTitle'),
      message: t('you.signOutConfirmBody'),
      buttons: [
        { key: 'cancel', label: t('common.cancel'), style: 'cancel' },
        { key: 'signout', label: t('you.signOut'), style: 'destructive' },
      ],
    });
    if (r === 'signout') await signOut();
  }

  async function confirmDeleteAccount() {
    if (isPopupJustClosed() || deleting) return;
    const r = await showAlert({
      title: t('you.deleteAccountConfirmTitle'),
      message: t('you.deleteAccountConfirmBody'),
      buttons: [
        { key: 'cancel', label: t('common.cancel'), style: 'cancel' },
        { key: 'delete', label: t('you.deleteAccount'), style: 'destructive' },
      ],
    });
    if (r !== 'delete') return;
    setDeleting(true);
    try {
      await api.deleteAccount();
      await signOut();
    } catch {
      await showAlert({ title: t('you.deleteAccountFailedTitle'), message: t('you.deleteAccountFailedBody') });
    } finally {
      setDeleting(false);
    }
  }

  const syncMeta = sync.running
    ? t('you.syncing')
    : sync.error
      ? sync.error === 'network'
        ? t('you.syncFailedNetwork')
        : t('you.syncFailed')
      : sync.lastSuccessAt
        ? t('you.syncLast', { when: formatDistanceToNow(sync.lastSuccessAt, { addSuffix: true }) })
        : t('you.syncNever');
  const syncValue = pendingCount > 0 ? t('you.syncPending', { count: pendingCount }) : undefined;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('you.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          <View style={styles.profile}>
            <TouchableOpacity
              onPress={openAvatarSheet}
              activeOpacity={0.8}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={t('you.avatar.changePhoto')}
              accessibilityState={{ disabled: uploading, busy: uploading }}
              hitSlop={8}
            >
              <Avatar
                initials={initialsFor(user?.name ?? '', user?.email ?? '')}
                source={avatarSource}
                style={styles.avatar}
              />
              {uploading ? (
                <View style={styles.avatarOverlay} testID="avatar-uploading">
                  <ActivityIndicator color={colors.paper} />
                </View>
              ) : (
                <View style={styles.avatarBadge} importantForAccessibility="no">
                  <Feather name="camera" size={12} color={colors.paper} />
                </View>
              )}
            </TouchableOpacity>
            <Text variant="title" style={styles.name}>{user?.name?.trim() || user?.email}</Text>
            {user?.email ? (
              <Text variant="monoCaption" color={colors.lead}>{user.email}</Text>
            ) : null}
          </View>

          <ListSectionHeader title={t('you.dictionaryEyebrow')} />
          <ListGroup>
            <ListRow
              label={t('you.dictionary')}
              value={termCount == null ? undefined : t('you.dictionaryTerms', { count: termCount })}
              hint={t('you.dictionaryHint')}
              onPress={() => router.push('/settings/dictionary')}
              testID="dictionary-row"
            />
          </ListGroup>

          <ListSectionHeader title={t('you.syncEyebrow')} />
          <ListGroup>
            <ListRow
              label={t('you.sync')}
              meta={syncMeta}
              value={syncValue}
              hint={t('you.syncHint')}
              trailing="none"
              right={
                sync.running ? (
                  <ActivityIndicator color={colors.lead} testID="sync-spinner" />
                ) : (
                  <View style={styles.rowRight}>
                    {syncValue ? (
                      <Text variant="monoBodyS" color={colors.lead}>
                        {syncValue}
                      </Text>
                    ) : null}
                    <Feather
                      name={sync.error ? 'alert-circle' : 'refresh-cw'}
                      size={18}
                      color={sync.error ? colors.brick : colors.lead}
                      importantForAccessibility="no"
                      accessibilityElementsHidden
                    />
                  </View>
                )
              }
              disabled={sync.running}
              onPress={() => void syncNowTapped()}
              testID="sync-row"
            />
          </ListGroup>

          <ListSectionHeader title={t('you.settingsEyebrow')} />
          <ListGroup>
            {showLanguageRow ? (
              <ListRow
                label={t('you.language')}
                value={selectedLanguage ? selectedLanguage : t('you.languageAuto')}
                hint={t('you.languageHint')}
                onPress={() => setLanguageOpen(true)}
              />
            ) : null}
            <ListRow
              label={t('you.about')}
              hint={t('you.aboutHint')}
              onPress={() => router.push('/settings/about')}
            />
          </ListGroup>

          <ListSectionHeader title={t('you.accountEyebrow')} />
          <ListGroup>
            <ListRow label={t('you.signOut')} destructive trailing="none" onPress={confirmSignOut} />
            <ListRow
              label={t('you.deleteAccount')}
              destructive
              trailing="none"
              disabled={deleting}
              onPress={() => void confirmDeleteAccount()}
            />
          </ListGroup>

          {__DEV__ ? (
            <>
              <ListSectionHeader title="Devtools" />
              <ListGroup>
                <ListRow
                  label="Seed prior sessions"
                  trailing="none"
                  onPress={() => void handleSeedPriorSessions()}
                />
              </ListGroup>
            </>
          ) : null}
        </ContentContainer>
      </ScrollView>

      <ActionSheet
        visible={avatarSheet}
        onClose={() => setAvatarSheet(false)}
        title={t('you.avatar.chooseTitle')}
        options={avatarOptions}
      />
      <LanguagePicker
        visible={languageOpen}
        selected={selectedLanguage}
        onClose={() => setLanguageOpen(false)}
        onSelectAutomatic={() => void setLanguage('en')}
        onSelect={(code) => void setLanguage(code)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingTop: spacing.s5 },
  profile: { alignItems: 'center', gap: spacing.s1, marginBottom: spacing.s6 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    backgroundColor: 'rgba(45, 31, 26, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.graphite,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.paper,
  },
  name: { ...typography.title, marginTop: spacing.s2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
});
