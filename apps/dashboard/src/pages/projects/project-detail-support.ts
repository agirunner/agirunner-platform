import type {
  DashboardEffectiveModelResolution,
  DashboardProjectRecord,
  DashboardProjectSpecRecord,
  DashboardRoleModelOverride,
} from '../../lib/api.js';

export const PROJECT_DETAIL_TAB_OPTIONS = [
  {
    value: 'spec',
    label: 'Spec',
    description:
      'Edit project config, instructions, resources, documents, and tools as structured entries.',
  },
  {
    value: 'resources',
    label: 'Resources',
    description: 'Review project-scoped resources and metadata with a phone-safe layout.',
  },
  {
    value: 'tools',
    label: 'Tools',
    description: 'Check which tools are available or blocked for this project.',
  },
  {
    value: 'timeline',
    label: 'Delivery',
    description: 'Inspect project run history, board posture, and operator drill-ins.',
  },
  {
    value: 'memory',
    label: 'Memory',
    description: 'Manage shared project memory with typed entries and responsive review.',
  },
  {
    value: 'artifacts',
    label: 'Artifacts',
    description: 'Browse project-scoped artifacts without leaving the workspace.',
  },
  {
    value: 'models',
    label: 'Models',
    description: 'Set project model overrides and verify the resolved effective models.',
  },
  {
    value: 'automation',
    label: 'Automation',
    description: 'Manage schedules, inbound webhooks, and repository signature posture.',
  },
] as const;

export type ProjectDetailTabValue = (typeof PROJECT_DETAIL_TAB_OPTIONS)[number]['value'];

export interface ProjectWorkspaceOverviewPacket {
  label: string;
  value: string;
  detail: string;
}

export interface ProjectWorkspaceOverview {
  summary: string;
  packets: ProjectWorkspaceOverviewPacket[];
}

export interface ProjectModelOverview {
  summary: string;
  packets: ProjectWorkspaceOverviewPacket[];
}

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

export function normalizeProjectDetailTab(value: string | null | undefined): ProjectDetailTabValue {
  const normalized = value?.trim() ?? '';
  return PROJECT_DETAIL_TAB_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as ProjectDetailTabValue)
    : 'spec';
}

export function buildProjectWorkspaceOverview(
  project: DashboardProjectRecord,
  spec?: DashboardProjectSpecRecord | null,
): ProjectWorkspaceOverview {
  const memoryCount = countObjectEntries(project.memory);
  const configCount = countObjectEntries(spec?.config);
  const instructionCount = countObjectEntries(spec?.instructions);
  const linkedAssetCount =
    countObjectEntries(spec?.resources) +
    countObjectEntries(spec?.documents) +
    countObjectEntries(spec?.tools);
  const updatedLabel = formatProjectDateTime(project.updated_at ?? spec?.updated_at);

  return {
    summary:
      'Keep project spec, live context, artifacts, delivery history, models, and automation reachable from one workspace instead of bouncing between secondary screens.',
    packets: [
      {
        label: 'Project status',
        value: project.is_active ? 'Active' : 'Inactive',
        detail:
          updatedLabel === '-'
            ? 'Project activity state is available, but no recent update timestamp is recorded.'
            : `Last updated ${updatedLabel}.`,
      },
      {
        label: 'Structured spec',
        value: `${configCount + instructionCount} entries`,
        detail: `${configCount} config • ${instructionCount} instructions`,
      },
      {
        label: 'Linked assets',
        value: `${linkedAssetCount} items`,
        detail: 'Counts project resources, documents, and tool policy entries.',
      },
      {
        label: 'Shared memory',
        value: `${memoryCount} entries`,
        detail:
          memoryCount > 0
            ? 'Shared project context is already available for runs and operators.'
            : 'Add reusable project context so future runs start with the right baseline.',
      },
      {
        label: 'Repo signature',
        value: project.git_webhook_provider ? 'Configured' : 'Needs setup',
        detail: project.git_webhook_provider
          ? `${project.git_webhook_provider} signature verification is configured for this project.`
          : 'Set a repository webhook secret if this project accepts signed inbound repository events.',
      },
    ],
  };
}

export function buildProjectModelOverview(
  overrides: Record<string, DashboardRoleModelOverride> | null | undefined,
  effectiveModels: Record<string, DashboardEffectiveModelResolution> | null | undefined,
): ProjectModelOverview {
  const overrideCount = countObjectEntries(overrides);
  const resolutions = Object.values(effectiveModels ?? {});
  const resolvedCount = resolutions.length;
  const fallbackCount = resolutions.filter((resolution) => resolution.fallback).length;
  const unresolvedCount = resolutions.filter((resolution) => !resolution.resolved).length;

  let summary =
    'Project-level overrides are empty. Resolved roles currently inherit from broader model posture.';
  if (overrideCount > 0 && fallbackCount === 0) {
    summary =
      'Project-specific role overrides are in place and the currently resolved roles are not falling back.';
  } else if (fallbackCount > 0) {
    summary =
      'At least one resolved role is falling back. Review provider/model availability before operators rely on this project posture.';
  }

  return {
    summary,
    packets: [
      {
        label: 'Project overrides',
        value: `${overrideCount} role${overrideCount === 1 ? '' : 's'}`,
        detail:
          overrideCount > 0
            ? 'Project-level provider and model overrides are explicitly configured.'
            : 'No project-only overrides are saved yet.',
      },
      {
        label: 'Resolved roles',
        value: `${resolvedCount} role${resolvedCount === 1 ? '' : 's'}`,
        detail:
          resolvedCount > 0
            ? 'These are the effective role model assignments currently visible to operators.'
            : 'No resolved role model assignments are available yet.',
      },
      {
        label: 'Fallbacks',
        value: `${fallbackCount} active`,
        detail:
          fallbackCount > 0
            ? 'One or more roles are using fallback resolution.'
            : unresolvedCount > 0
              ? `${unresolvedCount} role${unresolvedCount === 1 ? '' : 's'} still have no resolved model.`
              : 'No fallback resolution is currently active.',
      },
    ],
  };
}

export function createStructuredEntryDraft(): StructuredEntryDraft {
  return {
    id: nextDraftId('entry'),
    key: '',
    valueType: 'string',
    value: '',
  };
}

export function objectToStructuredDrafts(
  value: Record<string, unknown> | null | undefined,
): StructuredEntryDraft[] {
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
    const reasoningConfig = reasoning
      ? parseJsonRecord(reasoning, `Project model override '${role}' reasoning`)
      : undefined;
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
    throw new Error(
      `${label} must be valid JSON: ${error instanceof Error ? error.message : 'parse error'}`,
    );
  }
}

function nextDraftId(prefix: string): string {
  draftCounter += 1;
  return `${prefix}-${draftCounter}`;
}

function countObjectEntries(value: Record<string, unknown> | null | undefined): number {
  return Object.keys(value ?? {}).length;
}

function formatProjectDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}
