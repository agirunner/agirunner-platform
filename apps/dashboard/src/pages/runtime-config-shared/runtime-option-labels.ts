const RUNTIME_OPTION_LABELS: Record<string, string> = {
  auto: 'Auto',
  reactive: 'Reactive',
  tpaov: 'TPAOV',
  semantic_local: 'Semantic local',
  deterministic: 'Deterministic',
  provider_native: 'Provider native',
  activation_checkpoint: 'Activation checkpoint',
  emergency_only: 'Emergency only',
  off: 'Off',
  true: 'True',
  false: 'False',
  always: 'Always',
  'if-not-present': 'If not present',
  never: 'Never',
};

export function formatRuntimeOptionLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const explicitLabel = RUNTIME_OPTION_LABELS[trimmed];
  if (explicitLabel) {
    return explicitLabel;
  }

  return trimmed
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
