import { useTranslation } from 'react-i18next';
import { RANGES, type Range } from '@/lib/exerciseProgress';
import { ChipTabs } from './ChipTabs';

// i18n parser hint — keys are built from a template below:
// t('stats.range.1m') t('stats.range.3m') t('stats.range.6m') t('stats.range.1y') t('stats.range.all')

interface Props {
  value: Range;
  onChange: (r: Range) => void;
}

export function RangeChips({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <ChipTabs
      label={t('stats.rangeGroup')}
      options={RANGES.map((r) => ({ value: r, label: t(`stats.range.${r}`) }))}
      value={value}
      onChange={onChange}
    />
  );
}
