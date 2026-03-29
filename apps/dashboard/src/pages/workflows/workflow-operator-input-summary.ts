export function buildOperatorFacingSummaryLines(value: unknown): string[] {
  return readOperatorFacingEntries(value).map(
    ([label, renderedValue]) => `${label}: ${renderedValue}`,
  );
}

export function readOperatorFacingEntries(value: unknown): Array<[string, string]> {
  if (!isRecord(value)) {
    return [];
  }

  const rendered: Array<[string, string]> = [];
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeOperatorFacingKey(key);
    if (!shouldRenderOperatorFacingKey(normalizedKey)) {
      continue;
    }

    if (shouldSuppressOpaqueOperatorFacingValue(normalizedKey, entryValue)) {
      continue;
    }

    const renderedValue = renderOperatorFacingValue(entryValue);
    if (!renderedValue) {
      continue;
    }

    rendered.push([humanizeOperatorFacingLabel(key), renderedValue]);
  }

  return rendered;
}

function renderOperatorFacingValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = sanitizeOperatorFacingString(value);
    return trimmed.length > 0 ? humanizeOperatorFacingText(trimmed) : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => renderOperatorFacingValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    return items.length > 0 ? items.join(' • ') : null;
  }
  if (isRecord(value)) {
    const entries = readOperatorFacingEntries(value);
    if (entries.length === 0) {
      return null;
    }
    return entries.map(([label, text]) => `${label}: ${text}`).join(' • ');
  }
  return null;
}

function shouldRenderOperatorFacingKey(normalizedKey: string): boolean {
  if (normalizedKey.length === 0) {
    return false;
  }
  if (
    normalizedKey === 'slug' ||
    normalizedKey === 'slugs' ||
    normalizedKey.endsWith('_slug') ||
    normalizedKey.endsWith('_slugs')
  ) {
    return false;
  }
  if (
    normalizedKey === 'subject_revision' ||
    normalizedKey === 'activation_id' ||
    normalizedKey === 'execution_context_id'
  ) {
    return false;
  }
  if (normalizedKey.endsWith('_id') || normalizedKey.endsWith('_ids')) {
    return false;
  }
  return true;
}

function shouldSuppressOpaqueOperatorFacingValue(
  normalizedKey: string,
  value: unknown,
): boolean {
  if (!looksLikeInternalReferenceLabel(normalizedKey)) {
    return false;
  }

  if (typeof value === 'string') {
    return looksLikeOpaqueReferenceValue(value.trim());
  }

  if (Array.isArray(value)) {
    return (
      value.length > 0 &&
      value.every(
        (entry) => typeof entry === 'string' && looksLikeOpaqueReferenceValue(entry.trim()),
      )
    );
  }

  return false;
}

function looksLikeInternalReferenceLabel(value: string): boolean {
  return (
    value === 'artifact' ||
    value === 'artifacts' ||
    value === 'subject' ||
    value === 'subjects' ||
    value === 'task' ||
    value === 'tasks' ||
    value === 'workflow' ||
    value === 'workflows' ||
    value === 'work_item' ||
    value === 'work_items' ||
    value === 'activation' ||
    value === 'execution_context'
  );
}

function normalizeOperatorFacingKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function humanizeOperatorFacingLabel(value: string): string {
  const normalized = normalizeOperatorFacingKey(value);
  if (normalized === 'deliverable') {
    return 'Requested deliverable';
  }
  if (normalized === 'acceptance_criteria') {
    return 'Success criteria';
  }
  if (normalized === 'owner_role') {
    return 'Owner role';
  }
  if (normalized === 'next_expected_actor') {
    return 'Next actor';
  }
  if (normalized === 'next_expected_action') {
    return 'Next action';
  }
  if (normalized === 'gate_status') {
    return 'Gate status';
  }
  if (normalized === 'blocked_state') {
    return 'Blocked state';
  }
  if (normalized === 'escalation_status') {
    return 'Escalation';
  }
  if (normalized === 'checklist') {
    return 'Checklist';
  }
  return humanizeToken(normalized);
}

function humanizeOperatorFacingText(value: string): string {
  if (!looksLikeMachineToken(value)) {
    return value;
  }
  return humanizeToken(value);
}

function sanitizeOperatorFacingString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return stripCredentialedUrl(trimmed);
}

function stripCredentialedUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.username && !parsed.password) {
      return value;
    }
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return value;
  }
}

function looksLikeMachineToken(value: string): boolean {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/i.test(value);
}

function looksLikeOpaqueReferenceValue(value: string): boolean {
  return looksLikeOpaqueIdentifier(value)
    || /^[a-z0-9]+(?:[_-][a-z0-9]+){2,}$/i.test(value);
}

function looksLikeOpaqueIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
