export function progressColor(actualSets: number, targetMin: number, targetMax: number): string {
  const ratio = targetMax > 0 ? actualSets / targetMax : 0;
  if (ratio >= 1) return '#dc2626';
  if (actualSets >= targetMin) return '#f59e42';
  return '#fde2e2';
}
