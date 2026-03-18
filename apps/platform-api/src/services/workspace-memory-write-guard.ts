import { ValidationError } from '../errors/domain-errors.js';

interface WorkspaceMemoryWriteEntry {
  key: string;
  value: unknown;
}

const OPERATIONAL_KEY_HINTS = [
  'status',
  'state',
  'gate',
  'checkpoint',
  'next_expected',
  'rework',
] as const;

const OPERATIONAL_VALUE_KEYS = new Set([
  'status',
  'state',
  'gate_status',
  'checkpoint',
  'stage',
  'stage_name',
  'work_item_id',
  'next_expected_actor',
  'next_expected_action',
  'rework_count',
]);

export function assertWorkspaceMemoryWritesAreDurableKnowledge(
  entries: WorkspaceMemoryWriteEntry[],
) {
  for (const entry of entries) {
    if (!looksLikeOperationalState(entry.key, entry.value)) {
      continue;
    }
    throw new ValidationError(
      'Workspace memory stores durable knowledge only; write workflow status, gate posture, and continuity state to work items or handoffs instead',
      { key: entry.key },
    );
  }
}

function looksLikeOperationalState(key: string, value: unknown) {
  const normalizedKey = key.trim().toLowerCase();
  if (normalizedKey.length === 0) {
    return false;
  }

  if (isOperationalScalar(normalizedKey, value)) {
    return true;
  }

  const record = asRecord(value);
  if (!record) {
    return false;
  }

  const keys = new Set(
    Object.keys(record).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );

  if (keys.has('next_expected_actor') || keys.has('next_expected_action') || keys.has('rework_count')) {
    return true;
  }

  const hasStatusMarker = keys.has('status') || keys.has('state') || keys.has('gate_status');
  const hasContinuityMarker =
    keys.has('work_item_id')
    || keys.has('checkpoint')
    || keys.has('stage')
    || keys.has('stage_name');

  if (hasStatusMarker && hasContinuityMarker) {
    return true;
  }

  return keyHintsOperationalState(normalizedKey) && hasContinuityMarker;
}

function isOperationalScalar(key: string, value: unknown) {
  if (typeof value !== 'string') {
    return false;
  }
  return keyHintsOperationalState(key) && looksLikeLifecycleOrGateState(value);
}

function keyHintsOperationalState(key: string) {
  return OPERATIONAL_KEY_HINTS.some((fragment) => key.includes(fragment));
}

function looksLikeLifecycleOrGateState(value: string) {
  const normalized = value.trim().toLowerCase();
  return OPERATIONAL_VALUE_KEYS.has(normalized) || normalized.startsWith('awaiting_') || normalized.endsWith('_approval');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
