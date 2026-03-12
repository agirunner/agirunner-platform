export type MemoryEditorKind = 'string' | 'number' | 'boolean' | 'json';

export interface MemoryEditorDraft {
  kind: MemoryEditorKind;
  textValue: string;
  booleanValue: 'true' | 'false';
}

export function createMemoryEditorDraft(value: unknown): MemoryEditorDraft {
  const kind = inferMemoryEditorKind(value);
  if (kind === 'boolean') {
    return {
      kind,
      textValue: '',
      booleanValue: value === true ? 'true' : 'false',
    };
  }
  if (kind === 'string') {
    return {
      kind,
      textValue: typeof value === 'string' ? value : '',
      booleanValue: 'false',
    };
  }
  return {
    kind,
    textValue: kind === 'number' ? String(value) : JSON.stringify(value, null, 2),
    booleanValue: 'false',
  };
}

export function parseMemoryEditorDraft(
  draft: MemoryEditorDraft,
): { value: unknown; error: null } | { value: null; error: string } {
  if (draft.kind === 'string') {
    return { value: draft.textValue, error: null };
  }
  if (draft.kind === 'boolean') {
    return { value: draft.booleanValue === 'true', error: null };
  }
  if (draft.kind === 'number') {
    const parsed = Number(draft.textValue.trim());
    if (!Number.isFinite(parsed)) {
      return { value: null, error: 'Enter a valid number before saving.' };
    }
    return { value: parsed, error: null };
  }
  try {
    return { value: JSON.parse(draft.textValue), error: null };
  } catch {
    return { value: null, error: 'JSON values must be valid before saving.' };
  }
}

export function inferMemoryEditorKind(value: unknown): MemoryEditorKind {
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'json';
}

export function summarizeMemoryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 120)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'Empty list' : `${value.length} items`;
  }
  const record = asRecord(value);
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return 'Empty object';
  }
  return `${keys.length} fields: ${keys.slice(0, 4).join(', ')}`;
}

export function isStructuredMemoryValue(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
