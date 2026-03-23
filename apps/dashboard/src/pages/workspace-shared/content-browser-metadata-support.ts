export type MetadataValueType = 'string' | 'number' | 'boolean' | 'json';

export interface MetadataDraft {
  id: string;
  key: string;
  valueType: MetadataValueType;
  value: string;
}

let nextMetadataDraftId = 0;

export function createMetadataDraft(valueType: MetadataValueType = 'string'): MetadataDraft {
  nextMetadataDraftId += 1;
  return {
    id: `metadata-draft-${nextMetadataDraftId}`,
    key: '',
    valueType,
    value: valueType === 'boolean' ? 'true' : '',
  };
}

export function createMetadataDraftsFromRecord(record: Record<string, unknown>): MetadataDraft[] {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return [];
  }
  return entries.map(([key, value]) => ({
    id: createMetadataDraft().id,
    key,
    valueType: inferMetadataValueType(value),
    value: serializeMetadataValue(value),
  }));
}

export function updateMetadataDraft(
  drafts: MetadataDraft[],
  draftId: string,
  patch: Partial<MetadataDraft>,
): MetadataDraft[] {
  return drafts.map((draft) => {
    if (draft.id !== draftId) {
      return draft;
    }
    const nextValueType = patch.valueType ?? draft.valueType;
    const nextValue =
      patch.value !== undefined
        ? patch.value
        : patch.valueType && patch.valueType !== draft.valueType
          ? defaultValueForType(patch.valueType)
          : draft.value;
    return {
      ...draft,
      ...patch,
      valueType: nextValueType,
      value: nextValue,
    };
  });
}

export function buildMetadataRecord(
  drafts: MetadataDraft[],
): { value: Record<string, unknown> | null; error: string | null } {
  const record: Record<string, unknown> = {};
  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!key) {
      return { value: null, error: 'Metadata keys cannot be empty.' };
    }
    if (record[key] !== undefined) {
      return { value: null, error: `Duplicate metadata key "${key}".` };
    }
    const parsedValue = parseMetadataValue(draft);
    if (parsedValue.error) {
      return { value: null, error: parsedValue.error };
    }
    record[key] = parsedValue.value;
  }
  return { value: record, error: null };
}

function inferMetadataValueType(value: unknown): MetadataValueType {
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (value && typeof value === 'object') {
    return 'json';
  }
  return 'string';
}

function serializeMetadataValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return '';
}

function defaultValueForType(valueType: MetadataValueType): string {
  if (valueType === 'boolean') {
    return 'true';
  }
  return '';
}

function parseMetadataValue(
  draft: MetadataDraft,
): { value: unknown; error: string | null } {
  const key = draft.key.trim();
  if (draft.valueType === 'string') {
    return { value: draft.value, error: null };
  }
  if (draft.valueType === 'number') {
    const trimmed = draft.value.trim();
    if (!trimmed) {
      return { value: null, error: `Metadata value for "${key}" must be a number.` };
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed)
      ? { value: parsed, error: null }
      : { value: null, error: `Metadata value for "${key}" must be a number.` };
  }
  if (draft.valueType === 'boolean') {
    return { value: draft.value === 'true', error: null };
  }
  const trimmed = draft.value.trim();
  if (!trimmed) {
    return { value: {}, error: null };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: `Metadata value for "${key}" must be a JSON object.` };
    }
    return { value: parsed, error: null };
  } catch {
    return { value: null, error: `Metadata value for "${key}" must be valid JSON.` };
  }
}
