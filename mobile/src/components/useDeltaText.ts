import { useTranslation } from 'react-i18next';
import { colors } from '@/lib/theme';
import { formatDelta, type Measure } from '@/lib/exerciseProgress';

export type DeltaText = {
  /** Sighted label, e.g. "▲ +10 kg" or "1 session" for a first session. */
  text: string;
  /** Spoken label built from words, e.g. "up 10 kilograms". */
  a11y: string;
  color: string;
};

/** Visible + spoken text and colour for a delta; null (first session) reads "1 session". */
export function useDeltaText(delta: Measure | null): DeltaText {
  const { t } = useTranslation();
  if (!delta) {
    const text = t('stats.firstSession');
    return { text, a11y: text, color: colors.lead };
  }
  const text = formatDelta(delta);
  if (delta.value === 0) return { text, a11y: t('stats.deltaFlat'), color: colors.lead };
  const unit = delta.unit === 'kg' ? t('stats.unitKg') : t('stats.unitReps');
  const up = delta.value > 0;
  return {
    text,
    a11y: t(up ? 'stats.deltaUp' : 'stats.deltaDown', { value: Math.abs(delta.value), unit }),
    color: up ? colors.moss : colors.brick,
  };
}
