export function areJsonValuesEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeJsonValue(left)) === JSON.stringify(canonicalizeJsonValue(right));
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeJsonValue(entry));
  }
  if (!value || typeof value !== 'object') {
    return value ?? null;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((normalized, key) => {
      normalized[key] = canonicalizeJsonValue(record[key]);
      return normalized;
    }, {});
}
