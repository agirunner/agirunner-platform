import type {
  RoleOverrideDraft,
  StructuredEntryDraft,
  StructuredValueType,
} from './playbook-launch-support.js';

export interface StructuredEntryFieldError {
  key?: string;
  value?: string;
}

export interface StructuredEntryValidationResult {
  entryErrors: StructuredEntryFieldError[];
  blockingIssues: string[];
  isValid: boolean;
}

export interface RoleOverrideFieldError {
  role?: string;
  provider?: string;
  model?: string;
  reasoning: StructuredEntryValidationResult;
}

export interface RoleOverrideValidationResult {
  draftErrors: RoleOverrideFieldError[];
  blockingIssues: string[];
  isValid: boolean;
}

export function validateStructuredEntries(
  drafts: StructuredEntryDraft[],
): StructuredEntryValidationResult {
  const duplicateKeys = findDuplicateKeys(drafts);
  const entryErrors = drafts.map((draft) => validateStructuredEntry(draft, duplicateKeys));
  const blockingIssues = uniqueMessages(
    entryErrors.flatMap((entry) => [entry.key, entry.value]),
  );
  return {
    entryErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
}

export function validateRoleOverrideDrafts(
  drafts: RoleOverrideDraft[],
): RoleOverrideValidationResult {
  const duplicateRoles = findDuplicateRoles(drafts);
  const draftErrors = drafts.map((draft) => validateRoleOverrideDraft(draft, duplicateRoles));
  const blockingIssues = uniqueMessages(
    draftErrors.flatMap((draft) => [
      draft.role,
      draft.provider,
      draft.model,
      ...draft.reasoning.blockingIssues,
    ]),
  );
  return {
    draftErrors,
    blockingIssues,
    isValid: blockingIssues.length === 0,
  };
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
    fieldError.key = 'Add a key or remove this row.';
  } else if (duplicateKeys.has(key.toLowerCase())) {
    fieldError.key = 'Keys must be unique within this section.';
  }

  if (!value) {
    fieldError.value = 'Add a value or remove this row.';
  } else {
    fieldError.value = readValueError(draft.valueType, value);
  }
  return fieldError;
}

function validateRoleOverrideDraft(
  draft: RoleOverrideDraft,
  duplicateRoles: Set<string>,
): RoleOverrideFieldError {
  const role = draft.role.trim();
  const provider = draft.provider.trim();
  const model = draft.model.trim();
  const reasoning = validateStructuredEntries(draft.reasoningEntries);
  const hasReasoning = draft.reasoningEntries.some(
    (entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0,
  );
  const hasAnyValue =
    role.length > 0 || provider.length > 0 || model.length > 0 || hasReasoning;

  const fieldError: RoleOverrideFieldError = {
    reasoning,
  };
  if (!hasAnyValue) {
    return fieldError;
  }

  if (!role) {
    fieldError.role = 'Choose a role or remove this override.';
  } else if (duplicateRoles.has(role.toLowerCase())) {
    fieldError.role = 'Each role can only have one override.';
  }

  if (!provider) {
    fieldError.provider = 'Choose a provider or remove this override.';
  }
  if (!model) {
    fieldError.model = 'Choose a model or remove this override.';
  }

  return fieldError;
}

function readValueError(
  valueType: StructuredValueType,
  value: string,
): string | undefined {
  if (valueType === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? undefined : 'Enter a valid number.';
  }
  if (valueType === 'json') {
    try {
      JSON.parse(value);
      return undefined;
    } catch {
      return 'Enter valid JSON before launch.';
    }
  }
  return undefined;
}

function findDuplicateKeys(drafts: StructuredEntryDraft[]): Set<string> {
  return findDuplicateNormalizedValues(drafts.map((draft) => draft.key));
}

function findDuplicateRoles(drafts: RoleOverrideDraft[]): Set<string> {
  return findDuplicateNormalizedValues(drafts.map((draft) => draft.role));
}

function findDuplicateNormalizedValues(values: string[]): Set<string> {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
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
