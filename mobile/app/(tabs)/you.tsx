import { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/Text';
import { Avatar } from '@/components/Avatar';
import { TopBar } from '@/components/TopBar';
import { ContentContainer } from '@/components/ContentContainer';
import { ActionSheet, type ActionSheetOption } from '@/components/ActionSheet';
import { LanguagePicker } from '@/components/LanguagePicker';
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

  const [avatarSheet, setAvatarSheet] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const user = session?.user;
  const token = session?.token ?? null;
  const avatarSource = user ? api.avatarImageSource(user, token) : null;
  const hasAvatar = !!user?.avatar_object_url;
  const selectedLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language)
    ? (i18n.language as SupportedLanguage)
    : null;

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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar title={t('you.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}>
        <ContentContainer style={styles.content}>
          <View style={styles.profile}>
            <TouchableOpacity onPress={openAvatarSheet} activeOpacity={0.8} disabled={uploading}>
              <Avatar
                initials={initialsFor(user?.name ?? '', user?.email ?? '')}
                source={avatarSource}
                style={styles.avatar}
              />
              <View style={styles.avatarBadge}>
                <Feather name="camera" size={12} color={colors.paper} />
              </View>
            </TouchableOpacity>
            {uploading ? (
              <Text variant="monoCaption" color={colors.lead} style={styles.uploading}>
                {t('you.avatar.uploading')}
              </Text>
            ) : (
              <>
                <Text variant="title" style={styles.name}>{user?.name?.trim() || user?.email}</Text>
                {user?.email ? (
                  <Text variant="monoCaption" color={colors.lead}>{user.email}</Text>
                ) : null}
              </>
            )}
          </View>

          <Text variant="monoLabel" color={colors.lead} style={styles.eyebrow}>
            {t('you.settingsEyebrow')}
          </Text>
          <View style={styles.list}>
            <NavRow
              label={t('you.language')}
              value={selectedLanguage ? selectedLanguage : t('you.languageAuto')}
              onPress={() => setLanguageOpen(true)}
            />
            <NavRow label={t('you.about')} onPress={() => router.push('/settings/about')} />
          </View>

          <Text variant="monoLabel" color={colors.lead} style={styles.eyebrow}>
            {t('you.accountEyebrow')}
          </Text>
          <View style={styles.list}>
            <NavRow label={t('you.signOut')} destructive showChevron={false} onPress={confirmSignOut} />
          </View>
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

function NavRow({
  label,
  value,
  onPress,
  destructive,
  showChevron = true,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  destructive?: boolean;
  showChevron?: boolean;
}) {
  const labelColor = destructive ? colors.brick : colors.graphite;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.rowLabel, { color: labelColor }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {showChevron ? (
          <Feather name="chevron-right" size={18} color={destructive ? colors.brick : colors.lead} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { paddingTop: spacing.s5 },
  profile: { alignItems: 'center', gap: spacing.s1, marginBottom: spacing.s6 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
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
  uploading: { marginTop: spacing.s3 },
  eyebrow: {
    letterSpacing: 0.3,
    paddingHorizontal: spacing.s5,
    marginBottom: spacing.s2,
  },
  list: {
    borderTopWidth: 1,
    borderTopColor: colors.ruleSoft,
    marginBottom: spacing.s6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.s5,
    paddingVertical: spacing.s4,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
  },
  rowLabel: { ...typography.body },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  rowValue: { ...typography.monoBodyS, color: colors.lead },
});
