import {
  buildStructuredObject,
  objectToStructuredDrafts,
  type StructuredEntryDraft,
  type StructuredValueType,
} from '../workspace-detail/workspace-detail-support.js';

export type WorkItemPriority = 'critical' | 'high' | 'normal' | 'low';

export const WORK_ITEM_PRIORITY_OPTIONS: Array<{
  value: WorkItemPriority;
  label: string;
  description: string;
}> = [
  {
    value: 'critical',
    label: 'Critical',
    description: 'Immediate operator focus with the highest board urgency.',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Important board work that should stay near the front of the queue.',
  },
  {
    value: 'normal',
    label: 'Normal',
    description: 'Standard delivery work with normal operator attention.',
  },
  {
    value: 'low',
    label: 'Low',
    description: 'Background or follow-up work that can wait behind active board priorities.',
  },
];

export interface StructuredEntryFieldError {
  key?: string;
  value?: string;
}

export interface StructuredEntryValidationResult {
  entryErrors: StructuredEntryFieldError[];
  blockingIssues: string[];
  isValid: boolean;
}

export interface WorkItemMetadataDraftState {
  drafts: StructuredEntryDraft[];
  lockedDraftIds: string[];
}

export function normalizeWorkItemPriority(
  value: string | null | undefined,
): WorkItemPriority {
  return WORK_ITEM_PRIORITY_OPTIONS.some((option) => option.value === value)
    ? (value as WorkItemPriority)
    : 'normal';
}

export function createWorkItemMetadataDraftState(
  metadata: Record<string, unknown> | null | undefined,
): WorkItemMetadataDraftState {
  const drafts = objectToStructuredDrafts(metadata);
  return {
    drafts,
    lockedDraftIds: drafts.map((draft) => draft.id),
  };
}

export function buildWorkItemMetadata(
  drafts: StructuredEntryDraft[],
): Record<string, unknown> | undefined {
  return buildStructuredObject(drafts, 'Work item metadata');
}

export function validateWorkItemMetadataEntries(
  drafts: StructuredEntryDraft[],
): StructuredEntryValidationResult {
  const duplicateKeys = findDuplicateKeys(drafts);
  const entryErrors = drafts.map((draft) =>
    validateStructuredEntry(draft, duplicateKeys),
  );
  const blockingIssues = uniqueMessages(
    entryErrors.flatMap((entry) => [entry.key, entry.value]),
  );
  return {
    entryErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function areWorkItemMetadataDraftsEqual(
  drafts: StructuredEntryDraft[],
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  try {
    const current = JSON.stringify(sortStructuredValue(metadata ?? {}));
    const next = JSON.stringify(sortStructuredValue(buildWorkItemMetadata(drafts) ?? {}));
    return current === next;
  } catch {
    return false;
  }
}

function validateStructuredEntry(
  draft: StructuredEntryDraft,
  duplicateKeys: Set<string>,
): StructuredEntryFieldError {
  const key = draft.key.trim();
  const value = draft.value.trim();
  const hasAnyValue = key.length > 0 || value.length > 0;
  if (!hasAnyValue) {
    return {};
  }

  const fieldError: StructuredEntryFieldError = {};
  if (!key) {
    fieldError.key = 'Add a metadata key or remove this row.';
  } else if (duplicateKeys.has(key.toLowerCase())) {
    fieldError.key = 'Keys must be unique within work-item metadata.';
  }

  if (!value) {
    fieldError.value = 'Add a metadata value or remove this row.';
  } else {
    fieldError.value = readValueError(draft.valueType, value);
  }
  return fieldError;
}

function readValueError(
  valueType: StructuredValueType,
  value: string,
): string | undefined {
  if (valueType === 'number') {
    return Number.isFinite(Number(value)) ? undefined : 'Enter a valid number.';
  }
  if (valueType === 'json') {
    try {
      JSON.parse(value);
      return undefined;
    } catch {
      return 'Enter valid JSON before saving.';
    }
  }
  return undefined;
}

function findDuplicateKeys(drafts: StructuredEntryDraft[]): Set<string> {
  const normalized = drafts
    .map((draft) => draft.key.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return new Set(
    normalized.filter((value, index) => normalized.indexOf(value) !== index),
  );
}

function uniqueMessages(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function sortStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortStructuredValue(entry));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortStructuredValue(record[key]);
        return acc;
      }, {});
  }
  return value;
}
