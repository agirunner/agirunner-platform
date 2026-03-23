export type StructuredParameterValueType = 'string' | 'number' | 'boolean' | 'json';

export interface StructuredParameterEntry {
  id: string;
  key: string;
  valueType: StructuredParameterValueType;
  value: string;
}

export interface StructuredParameterEntryError {
  key?: string;
  value?: string;
}

export interface StructuredParameterValidationResult {
  entryErrors: StructuredParameterEntryError[];
  blockingIssues: string[];
  isValid: boolean;
}

export interface StructuredParameterEditorState {
  entries: StructuredParameterEntry[];
  sourceError?: string;
}

let entryCounter = 0;

export function createStructuredParameterEntry(): StructuredParameterEntry {
  entryCounter += 1;
  return {
    id: `structured-default-${entryCounter}`,
    key: '',
    valueType: 'string',
    value: '',
  };
}

export function readStructuredParameterEditorState(
  valueType: string,
  value: string,
): StructuredParameterEditorState {
  const trimmed = value.trim();
  if (valueType !== 'object' && valueType !== 'array') {
    return { entries: [] };
  }
  if (!trimmed) {
    return { entries: [] };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (valueType === 'object') {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
          entries: [],
          sourceError:
            'This object default is no longer valid structured data. Clear it or rebuild it with field rows.',
        };
      }
      return {
        entries: Object.entries(parsed as Record<string, unknown>).map(([key, entryValue]) => ({
          id: createStructuredParameterEntry().id,
          key,
          valueType: inferStructuredValueType(entryValue),
          value: stringifyStructuredValue(entryValue),
        })),
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        entries: [],
        sourceError:
          'This list default is no longer valid structured data. Clear it or rebuild it with item rows.',
      };
    }
    return {
      entries: parsed.map((entryValue) => ({
        id: createStructuredParameterEntry().id,
        key: '',
        valueType: inferStructuredValueType(entryValue),
        value: stringifyStructuredValue(entryValue),
      })),
    };
  } catch {
    return {
      entries: [],
      sourceError:
        valueType === 'object'
          ? 'This object default is no longer valid structured data. Clear it or rebuild it with field rows.'
          : 'This list default is no longer valid structured data. Clear it or rebuild it with item rows.',
    };
  }
}

export function validateStructuredParameterEntries(
  valueType: string,
  entries: StructuredParameterEntry[],
): StructuredParameterValidationResult {
  const duplicateKeys = findDuplicateKeys(entries);
  const entryErrors = entries.map((entry) =>
    readStructuredParameterEntryError(valueType, entry, duplicateKeys),
  );
  const blockingIssues = Array.from(
    new Set(
      entryErrors.flatMap((entry) =>
        [entry.key, entry.value].filter((issue): issue is string => Boolean(issue)),
      ),
    ),
  );
  return {
    entryErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function serializeStructuredParameterEntries(
  valueType: string,
  entries: StructuredParameterEntry[],
): string {
  const validation = validateStructuredParameterEntries(valueType, entries);
  if (!validation.isValid) {
    throw new Error(validation.blockingIssues[0] ?? 'Parameter default entries are invalid.');
  }

  if (valueType === 'object') {
    const value = entries.reduce<Record<string, unknown>>((record, entry) => {
      if (!shouldIncludeStructuredEntry('object', entry)) {
        return record;
      }
      record[entry.key.trim()] = parseStructuredValue(entry.valueType, entry.value);
      return record;
    }, {});
    return Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '';
  }

  if (valueType === 'array') {
    const value = entries
      .filter((entry) => shouldIncludeStructuredEntry('array', entry))
      .map((entry) => parseStructuredValue(entry.valueType, entry.value));
    return value.length > 0 ? JSON.stringify(value, null, 2) : '';
  }

  return '';
}

export function validateStructuredParameterDefaultValue(
  valueType: string,
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (valueType === 'object') {
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'Object defaults must be valid structured object data.';
      }
    }
    if (valueType === 'array' && !Array.isArray(parsed)) {
      return 'Array defaults must be valid structured list data.';
    }
    return undefined;
  } catch {
    return valueType === 'object'
      ? 'Object defaults must be valid structured object data.'
      : 'Array defaults must be valid structured list data.';
  }
}

function readStructuredParameterEntryError(
  valueType: string,
  entry: StructuredParameterEntry,
  duplicateKeys: Set<string>,
): StructuredParameterEntryError {
  if (!shouldValidateStructuredEntry(valueType, entry)) {
    return {};
  }

  const key = entry.key.trim();
  const error: StructuredParameterEntryError = {};
  if (valueType === 'object') {
    if (!key) {
      error.key = 'Add a field name or remove this row.';
    } else if (duplicateKeys.has(key.toLowerCase())) {
      error.key = 'Field names must be unique.';
    }
  }

  const valueError = readStructuredValueError(entry.valueType, entry.value);
  if (valueError) {
    error.value = valueError;
  }
  return error;
}

function shouldValidateStructuredEntry(
  valueType: string,
  entry: StructuredParameterEntry,
): boolean {
  const key = entry.key.trim();
  const value = entry.value.trim();
  if (valueType === 'object') {
    return key.length > 0 || value.length > 0 || entry.valueType !== 'string';
  }
  return value.length > 0 || entry.valueType !== 'string';
}

function shouldIncludeStructuredEntry(
  valueType: string,
  entry: StructuredParameterEntry,
): boolean {
  const key = entry.key.trim();
  const value = entry.value.trim();
  if (valueType === 'object') {
    return key.length > 0 || value.length > 0 || entry.valueType !== 'string';
  }
  return value.length > 0 || entry.valueType !== 'string';
}

function readStructuredValueError(
  valueType: StructuredParameterValueType,
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (valueType === 'string') {
    return undefined;
  }
  if (valueType === 'number') {
    if (!trimmed) {
      return 'Add a numeric value or remove this row.';
    }
    return Number.isFinite(Number(trimmed)) ? undefined : 'Enter a valid number.';
  }
  if (valueType === 'boolean') {
    return trimmed === 'true' || trimmed === 'false'
      ? undefined
      : 'Choose true or false for this value.';
  }
  if (!trimmed) {
    return 'Add valid JSON or remove this row.';
  }
  try {
    JSON.parse(trimmed);
    return undefined;
  } catch {
    return 'Enter valid JSON for this value.';
  }
}

function parseStructuredValue(
  valueType: StructuredParameterValueType,
  value: string,
): unknown {
  if (valueType === 'number') {
    return Number(value);
  }
  if (valueType === 'boolean') {
    return value.trim() === 'true';
  }
  if (valueType === 'json') {
    return JSON.parse(value);
  }
  return value;
}

function stringifyStructuredValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function inferStructuredValueType(value: unknown): StructuredParameterValueType {
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

function findDuplicateKeys(entries: StructuredParameterEntry[]): Set<string> {
  const normalized = entries
    .map((entry) => entry.key.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return new Set(
    normalized.filter((value, index) => normalized.indexOf(value) !== index),
  );
}
