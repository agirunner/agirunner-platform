export interface CostSample {
  providerReportedUsd: number;
  locallyTrackedUsd: number;
}

export function validateBudgetWithinTolerance(
  sample: CostSample,
  tolerance = 0.1,
): string[] {
  if (sample.providerReportedUsd < 0 || sample.locallyTrackedUsd < 0) {
    throw new Error('Cost values must be non-negative');
  }

  if (sample.providerReportedUsd === 0 && sample.locallyTrackedUsd === 0) {
    return ['cost_zero_ok'];
  }

  const denominator = Math.max(sample.providerReportedUsd, 0.000_001);
  const drift = Math.abs(sample.providerReportedUsd - sample.locallyTrackedUsd) / denominator;
  if (drift > tolerance) {
    throw new Error(
      `Budget drift ${Math.round(drift * 10000) / 100}% exceeds ${tolerance * 100}% tolerance`,
    );
  }

  return [`cost_within_tolerance:${Math.round(drift * 10000) / 100}%`];
}
