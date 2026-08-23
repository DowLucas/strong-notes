import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Modal,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/Text';
import { TopBar } from '@/components/TopBar';
import { IconButton } from '@/components/IconButton';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { ContentContainer } from '@/components/ContentContainer';
import { showAlert } from '@/lib/app-alert';
import { useAuth } from '@/lib/auth';
import type { Abbreviation } from '@/lib/api';
import { colors, radii, spacing, typography } from '@/lib/theme';
import {
  getCachedAbbreviations,
  removeCachedAbbreviation,
  upsertCachedAbbreviations,
} from '@/src/db/abbreviationsRepo';
import { syncNow } from '@/src/sync/syncEngine';

export const PENDING_SOURCE = 'LLM_SUGGESTED_PENDING_CONFIRM';

type Kind = 'exercise' | 'equipment';

/** Human description of what a token maps to. */
function describeTarget(a: Abbreviation, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (a.exerciseName) return a.exerciseName;
  if (a.modifierValue) {
    return t('dictionary.modifierValue', {
      value: a.modifierValue,
      type: a.modifierType === 'equipment' ? t('dictionary.kindEquipment').toLowerCase() : a.modifierType,
    });
  }
  return t('dictionary.unmapped');
}

function sortRows(rows: Abbreviation[]): Abbreviation[] {
  // Suggestions first so they get dealt with, then alphabetical.
  return [...rows].sort((a, b) => {
    const ap = a.source === PENDING_SOURCE ? 0 : 1;
    const bp = b.source === PENDING_SOURCE ? 0 : 1;
    return ap - bp || a.token.localeCompare(b.token);
  });
}

export default function Dictionary() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { api } = useAuth();

  const [rows, setRows] = useState<Abbreviation[] | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadCached = useCallback(async () => {
    setRows(sortRows(await getCachedAbbreviations()));
  }, []);

  // Cached rows first (instant), then a background sync refreshes them.
  useEffect(() => {
    let active = true;
    void loadCached().then(() =>
      syncNow(api)
        .then(() => {
          if (active) void loadCached();
        })
        .catch(() => {
          // Offline: the cache is what we show.
        }),
    );
    return () => {
      active = false;
    };
  }, [api, loadCached]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (a) =>
        a.token.toLowerCase().includes(q) ||
        (a.exerciseName ?? '').toLowerCase().includes(q) ||
        (a.modifierValue ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  /** Apply a server result to the local cache + screen without waiting for a sync. */
  async function applyUpdated(updated: Abbreviation) {
    await upsertCachedAbbreviations([updated]);
    setRows((prev) => sortRows([...(prev ?? []).filter((r) => r.id !== updated.id), updated]));
  }

  async function applyRemoved(id: string) {
    await removeCachedAbbreviation(id);
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
  }

  async function confirm(a: Abbreviation) {
    if (busyId) return;
    setBusyId(a.id);
    try {
      const updated = await api.confirmAbbreviation(a.id);
      // The server's confirm response omits exerciseName only if unknown —
      // keep what the cache already knew.
      await applyUpdated({ ...a, ...updated, exerciseName: updated.exerciseName ?? a.exerciseName });
    } catch {
      await showAlert({ title: t('common.error'), message: t('errors.generic') });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: Abbreviation, ask: boolean) {
    if (busyId) return;
    if (ask) {
      const r = await showAlert({
        title: t('dictionary.deleteConfirmTitle', { token: a.token }),
        message: t('dictionary.deleteConfirmBody'),
        buttons: [
          { key: 'cancel', label: t('common.cancel'), style: 'cancel' },
          { key: 'delete', label: t('dictionary.delete'), style: 'destructive' },
        ],
      });
      if (r !== 'delete') return;
    }
    setBusyId(a.id);
    try {
      await api.deleteAbbreviation(a.id);
      await applyRemoved(a.id);
    } catch {
      await showAlert({ title: t('common.error'), message: t('errors.generic') });
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <View>
      <View style={styles.searchCard}>
        <Field
          label={t('dictionary.searchLabel')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('dictionary.searchPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          testID="dictionary-search"
        />
      </View>
      <Button
        kind="secondary"
        onPress={() => setAdding(true)}
        accessibilityHint={t('dictionary.addHint')}
        style={styles.addButton}
      >
        {`+ ${t('dictionary.addShorthand')}`}
      </Button>
    </View>
  );

  const empty =
    rows == null ? null : rows.length === 0 ? (
      <EmptyState title={t('dictionary.emptyTitle')} body={t('dictionary.emptyBody')} icon="book-open" />
    ) : (
      <Text variant="bodyS" color={colors.lead} style={styles.noMatches}>
        {t('dictionary.noMatches', { query: query.trim() })}
      </Text>
    );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopBar
        title={t('dictionary.title')}
        left={<IconButton icon="chevron-left" label={t('common.back')} onPress={() => router.back()} />}
      />
      <FlatList
        data={visible}
        keyExtractor={(a) => a.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<ContentContainer>{header}</ContentContainer>}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s7 }}
        renderItem={({ item }) => (
          <ContentContainer>
            <DictionaryRow
              item={item}
              busy={busyId === item.id}
              onConfirm={() => void confirm(item)}
              onDismiss={() => void remove(item, false)}
              onDelete={() => void remove(item, true)}
            />
          </ContentContainer>
        )}
      />
      <AddShorthandSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onCreated={(created) => {
          void applyUpdated(created);
          setAdding(false);
        }}
      />
    </View>
  );
}

function DictionaryRow({
  item,
  busy,
  onConfirm,
  onDismiss,
  onDelete,
}: {
  item: Abbreviation;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const pending = item.source === PENDING_SOURCE;
  const target = describeTarget(item, t);
  return (
    <View style={[styles.row, busy && styles.rowBusy]} accessible accessibilityLabel={`${item.token}, ${target}`}>
      <View style={styles.rowMain}>
        <View style={styles.rowTitle}>
          <Text variant="monoBody" style={styles.token}>
            {item.token}
          </Text>
          <Feather name="arrow-right" size={14} color={colors.lead} importantForAccessibility="no" />
          <Text variant="body" numberOfLines={2} style={styles.target}>
            {target}
          </Text>
        </View>
        {pending ? (
          <View style={styles.pendingRow}>
            <Chip>{t('dictionary.suggested')}</Chip>
            <TouchableOpacity
              style={styles.inlineAction}
              onPress={onConfirm}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${t('dictionary.confirm')} ${item.token}`}
              accessibilityHint={t('dictionary.confirmHint')}
            >
              <Text variant="bodyEmphasis" color={colors.moss}>
                {t('dictionary.confirm')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.inlineAction}
              onPress={onDismiss}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${t('dictionary.dismiss')} ${item.token}`}
              accessibilityHint={t('dictionary.dismissHint')}
            >
              <Text variant="bodyEmphasis" color={colors.lead}>
                {t('dictionary.dismiss')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
      {!pending ? (
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={onDelete}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`${t('dictionary.delete')} ${item.token}`}
          accessibilityHint={t('dictionary.deleteHint')}
          hitSlop={4}
          testID={`delete-${item.token}`}
        >
          <Feather name="trash-2" size={20} color={colors.lead} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function AddShorthandSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (created: Abbreviation) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { api } = useAuth();
  const [token, setToken] = useState('');
  const [kind, setKind] = useState<Kind>('exercise');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setToken('');
    setKind('exercise');
    setTarget('');
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  const canSave = token.trim().length > 0 && target.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      let created: Abbreviation;
      if (kind === 'exercise') {
        // POST /api/exercises dedupes by name, so this links an existing
        // exercise or creates a new one.
        const exercise = await api.createExercise({ name: target.trim(), muscles: [] });
        created = await api.createAbbreviation({ token: token.trim(), exerciseId: exercise.id });
        created = { ...created, exerciseName: created.exerciseName ?? exercise.name };
      } else {
        created = await api.createAbbreviation({
          token: token.trim(),
          modifierType: 'equipment',
          modifierValue: target.trim().toLowerCase(),
        });
      }
      reset();
      onCreated(created);
    } catch {
      setError(t('dictionary.addFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.sheetBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.sheetScrim} onPress={close} accessibilityLabel={t('common.close')} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.s4 }]}>
          <View style={styles.sheetHeader}>
            <Text variant="title" accessibilityRole="header">
              {t('dictionary.addTitle')}
            </Text>
            <IconButton icon="x" label={t('common.close')} onPress={close} />
          </View>
          <View style={styles.sheetCard}>
            <Field
              label={t('dictionary.tokenLabel')}
              value={token}
              onChangeText={setToken}
              placeholder={t('dictionary.tokenPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              testID="add-token"
            />
            <View style={styles.kindRow}>
              <Text style={styles.kindLabel}>{t('dictionary.mapsTo')}</Text>
              <View style={styles.segment} accessibilityRole="radiogroup">
                {(['exercise', 'equipment'] as Kind[]).map((k) => {
                  const selected = kind === k;
                  const label = k === 'exercise' ? t('dictionary.kindExercise') : t('dictionary.kindEquipment');
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[styles.segmentItem, selected && styles.segmentItemSelected]}
                      onPress={() => setKind(k)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, checked: selected }}
                      accessibilityLabel={label}
                      testID={`kind-${k}`}
                    >
                      <Text variant="bodyEmphasis" color={selected ? colors.paper : colors.graphite}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <Field
              label={kind === 'exercise' ? t('dictionary.exerciseLabel') : t('dictionary.equipmentLabel')}
              value={target}
              onChangeText={setTarget}
              placeholder={
                kind === 'exercise' ? t('dictionary.exercisePlaceholder') : t('dictionary.equipmentPlaceholder')
              }
              autoCapitalize={kind === 'exercise' ? 'sentences' : 'none'}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              error={error}
              testID="add-target"
            />
          </View>
          <Button kind="positive" onPress={() => void save()} disabled={!canSave} busy={saving}>
            {saving ? t('dictionary.saving') : t('dictionary.save')}
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  searchCard: {
    backgroundColor: colors.bone,
    borderRadius: 10,
    marginHorizontal: spacing.s5,
    marginTop: spacing.s4,
  },
  addButton: { marginHorizontal: spacing.s5, marginVertical: spacing.s4 },
  noMatches: { textAlign: 'center', padding: spacing.s6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.s5,
    paddingRight: spacing.s2,
    paddingVertical: spacing.s3,
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: colors.ruleSoft,
    gap: spacing.s2,
  },
  rowBusy: { opacity: 0.5 },
  rowMain: { flex: 1, gap: spacing.s2 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2, flexWrap: 'wrap' },
  token: { ...typography.monoBody, color: colors.graphite },
  target: { flexShrink: 1 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s2 },
  inlineAction: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.s3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(45, 31, 26, 0.35)' },
  sheetScrim: { flex: 1 },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.s5,
    gap: spacing.s4,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetCard: { backgroundColor: colors.bone, borderRadius: 10 },
  kindRow: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.ruleSoft,
    gap: spacing.s2,
  },
  kindLabel: { ...typography.monoCaption, color: colors.lead, letterSpacing: 0.3 },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.graphite,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  segmentItem: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  segmentItemSelected: { backgroundColor: colors.graphite },
});
