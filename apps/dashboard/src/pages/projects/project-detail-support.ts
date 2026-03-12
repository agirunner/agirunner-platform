import type { DashboardRoleModelOverride } from '../../lib/api.js';

export type StructuredValueType = 'string' | 'number' | 'boolean' | 'json';

export interface StructuredEntryDraft {
  id: string;
  key: string;
  valueType: StructuredValueType;
  value: string;
}

export interface RoleOverrideDraft {
  id: string;
  role: string;
  provider: string;
  model: string;
  reasoningConfig: string;
}

let draftCounter = 0;

export function createStructuredEntryDraft(): StructuredEntryDraft {
  return {
    id: nextDraftId('entry'),
    key: '',
    valueType: 'string',
    value: '',
  };
}

export function objectToStructuredDrafts(value: Record<string, unknown> | null | undefined): StructuredEntryDraft[] {
  return Object.entries(value ?? {}).map(([key, entry]) => ({
    id: nextDraftId('entry'),
    key,
    valueType: inferValueType(entry),
    value: serializeValue(entry),
  }));
}

export function buildStructuredObject(
  drafts: StructuredEntryDraft[],
  label: string,
): Record<string, unknown> | undefined {
  const value: Record<string, unknown> = {};
  for (const draft of drafts) {
    const key = draft.key.trim();
    if (!key) {
      if (draft.value.trim() === '') {
        continue;
      }
      throw new Error(`${label} keys are required.`);
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} contains a duplicate key '${key}'.`);
    }
    const parsed = parseDraftValue(draft.value, draft.valueType, `${label} '${key}'`);
    if (parsed === undefined) {
      continue;
    }
    value[key] = parsed;
  }
  return Object.keys(value).length > 0 ? value : undefined;
}

export function createRoleOverrideDraft(role = ''): RoleOverrideDraft {
  return {
    id: nextDraftId('role'),
    role,
    provider: '',
    model: '',
    reasoningConfig: '',
  };
}

export function hydrateRoleOverrideDrafts(
  roles: string[],
  overrides: Record<string, DashboardRoleModelOverride>,
): RoleOverrideDraft[] {
  const ordered = roles.map((role) => {
    const override = overrides[role];
    return {
      id: nextDraftId('role'),
      role,
      provider: override?.provider ?? '',
      model: override?.model ?? '',
      reasoningConfig:
        override?.reasoning_config && Object.keys(override.reasoning_config).length > 0
          ? JSON.stringify(override.reasoning_config, null, 2)
          : '',
    };
  });
  const custom = Object.entries(overrides)
    .filter(([role]) => !roles.includes(role))
    .map(([role, override]) => ({
      id: nextDraftId('role'),
      role,
      provider: override.provider,
      model: override.model,
      reasoningConfig:
        override.reasoning_config && Object.keys(override.reasoning_config).length > 0
          ? JSON.stringify(override.reasoning_config, null, 2)
          : '',
    }));
  return [...ordered, ...custom];
}

export function buildRoleModelOverrides(
  drafts: RoleOverrideDraft[],
): Record<string, DashboardRoleModelOverride> | undefined {
  const overrides: Record<string, DashboardRoleModelOverride> = {};
  for (const draft of drafts) {
    const role = draft.role.trim();
    const provider = draft.provider.trim();
    const model = draft.model.trim();
    const reasoning = draft.reasoningConfig.trim();
    if (!role && !provider && !model && !reasoning) {
      continue;
    }
    if (!role) {
      throw new Error('Project model override roles are required.');
    }
    if (Object.prototype.hasOwnProperty.call(overrides, role)) {
      throw new Error(`Project model overrides contains a duplicate role '${role}'.`);
    }
    if (!provider || !model) {
      throw new Error(`Project model override '${role}' must include both provider and model.`);
    }
    const reasoningConfig = reasoning ? parseJsonRecord(reasoning, `Project model override '${role}' reasoning`) : undefined;
    overrides[role] = {
      provider,
      model,
      ...(reasoningConfig ? { reasoning_config: reasoningConfig } : {}),
    };
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function inferValueType(value: unknown): StructuredValueType {
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

function serializeValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function parseDraftValue(rawValue: string, valueType: StructuredValueType, label: string): unknown {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (valueType === 'number') {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} must be a valid number.`);
    }
    return parsed;
  }
  if (valueType === 'boolean') {
    if (trimmed !== 'true' && trimmed !== 'false') {
      throw new Error(`${label} must be true or false.`);
    }
    return trimmed === 'true';
  }
  if (valueType === 'json') {
    return parseJsonValue(trimmed, label);
  }
  return rawValue;
}

function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  const parsed = parseJsonValue(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : 'parse error'}`);
  }
}

function nextDraftId(prefix: string): string {
  draftCounter += 1;
  return `${prefix}-${draftCounter}`;
}
