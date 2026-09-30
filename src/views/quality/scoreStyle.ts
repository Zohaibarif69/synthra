import { scoreColor } from '../../lib/engine/quality';

const COLOR_VAR = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  muted: 'var(--color-text-muted)',
} as const;

/** CSS colour for a 0–100 score: green ≥ 90, orange 70–89, red < 70, muted for N/A. */
export function scoreVar(score: number | null): string {
  return COLOR_VAR[scoreColor(score)];
}

export function formatScore(score: number | null): string {
  return score === null ? 'N/A' : score.toFixed(1);
}
