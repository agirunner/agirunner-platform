import type {
  DashboardEffectiveModelResolution,
  DashboardProjectRecord,
  DashboardProjectSpecRecord,
  DashboardRoleModelOverride,
} from '../../lib/api.js';

export const PROJECT_DETAIL_TAB_OPTIONS = [
  {
    value: 'overview',
    label: 'Overview',
    description:
      'Start with project posture, knowledge depth, automation readiness, and delivery access.',
  },
  {
    value: 'settings',
    label: 'Settings',
    description:
      'Adjust project-specific control plane settings, especially model override posture.',
  },
  {
    value: 'knowledge',
    label: 'Knowledge',
    description:
      'Group structured spec, resources, tool policy, memory, and artifacts in one surface.',
  },
  {
    value: 'automation',
    label: 'Automation',
    description: 'Use one control center for schedules, inbound hooks, and repository signatures.',
  },
  {
    value: 'delivery',
    label: 'Delivery',
    description: 'Answer what ran, what failed, what needs attention, and what to inspect next.',
  },
] as const;

export type ProjectDetailTabValue = (typeof PROJECT_DETAIL_TAB_OPTIONS)[number]['value'];
export type ProjectDetailTabOption = (typeof PROJECT_DETAIL_TAB_OPTIONS)[number];

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

export interface ProjectDetailHeaderAction {
  label: string;
  href: string;
  variant: 'secondary' | 'outline' | 'ghost';
}

export interface ProjectDetailHeaderState {
  mode: 'expanded' | 'compact';
  title: string;
  description: string;
  activeTab: ProjectDetailTabOption;
  contextPills: string[];
  quickActions: ProjectDetailHeaderAction[];
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
    : 'overview';
}

export function buildProjectWorkspaceOverview(
  project: DashboardProjectRecord,
  spec?: DashboardProjectSpecRecord | null,
): ProjectWorkspaceOverview {
  const memoryCount = countObjectEntries(project.memory);
  const configCount = countObjectEntries(spec?.config);
  const instructionCount = countObjectEntries(spec?.instructions);
  const resourceCount = countObjectEntries(spec?.resources);
  const documentCount = countObjectEntries(spec?.documents);
  const toolCount = countObjectEntries(spec?.tools);
  const knowledgeCount =
    configCount + instructionCount + resourceCount + documentCount + toolCount + memoryCount;
  const updatedLabel = formatProjectDateTime(project.updated_at ?? spec?.updated_at);
  const deliveryOverview = buildProjectDeliveryOverview(project);

  return {
    summary:
      'Use this snapshot to confirm lifecycle, knowledge coverage, automation setup, and delivery activity before switching workspaces.',
    packets: [
      {
        label: 'Lifecycle',
        value: project.is_active ? 'Active' : 'Inactive',
        detail:
          updatedLabel === '-'
            ? 'Project activity state is available, but no recent update timestamp is recorded.'
            : `Last updated ${updatedLabel}.`,
      },
      {
        label: 'Knowledge base',
        value: `${knowledgeCount} entries`,
        detail: `${configCount} config • ${instructionCount} instructions • ${resourceCount + documentCount + toolCount} knowledge assets • ${memoryCount} memory`,
      },
      {
        label: 'Automation',
        value: project.git_webhook_provider ? 'Verified repo' : 'Needs setup',
        detail: project.git_webhook_provider
          ? `${project.git_webhook_provider} signatures are ready for inbound automation.`
          : 'Set repository trust before operators depend on inbound automation.',
      },
      {
        label: 'Repository',
        value: project.repository_url ? 'Linked' : 'Unlinked',
        detail: project.repository_url
          ? 'A repository URL is already attached to this project.'
          : 'Add a repository URL if delivery and automation should map back to source control.',
      },
      {
        label: 'Delivery',
        value: deliveryOverview.value,
        detail: deliveryOverview.detail,
      },
    ],
  };
}

export function buildProjectDetailHeaderState(
  project: DashboardProjectRecord,
  activeTab: ProjectDetailTabValue,
): ProjectDetailHeaderState {
  const activeTabOption = getProjectDetailTabOption(activeTab);
  if (activeTab === 'overview') {
    return {
      mode: 'expanded',
      title: project.name,
      description:
        normalizeProjectDescription(project.description)
        ?? 'Use this workspace to move between settings, knowledge, automation, and delivery without losing context.',
      activeTab: activeTabOption,
      contextPills: [],
      quickActions: [
        {
          label: 'Settings',
          href: `/projects/${project.id}?tab=settings`,
          variant: 'secondary',
        },
        {
          label: 'Knowledge base',
          href: `/projects/${project.id}?tab=knowledge`,
          variant: 'ghost',
        },
      ],
    };
  }

  return {
    mode: 'compact',
    title: project.name,
    description: activeTabOption.description,
    activeTab: activeTabOption,
    contextPills: [],
    quickActions: [
      {
        label: 'Back to overview',
        href: `/projects/${project.id}`,
        variant: 'ghost',
      },
    ],
  };
}

export function buildProjectSettingsOverview(
  project: DashboardProjectRecord,
): ProjectWorkspaceOverview {
  const settings = asRecord(project.settings);
  const modelOverrides = asRecord(settings.model_overrides);

  return {
    summary:
      'Settings is the project control plane: keep model overrides, stored settings, and repository trust posture together so operators can verify changes before launch.',
    packets: [
      {
        label: 'Stored settings',
        value: `${countObjectEntries(settings)} entries`,
        detail:
          'Project-scoped settings saved on the record, including model override configuration.',
      },
      {
        label: 'Model overrides',
        value: `${countObjectEntries(modelOverrides)} role${countObjectEntries(modelOverrides) === 1 ? '' : 's'}`,
        detail:
          countObjectEntries(modelOverrides) > 0
            ? 'Project-only role model overrides are already defined.'
            : 'No project-only role overrides are defined yet.',
      },
      {
        label: 'Repository trust',
        value: project.git_webhook_secret_configured ? 'Configured' : 'Needs setup',
        detail: project.git_webhook_secret_configured
          ? 'Inbound repository signatures can be verified.'
          : 'Finish webhook secret setup before trusting repository-driven automation.',
      },
      {
        label: 'Repository link',
        value: project.repository_url ? 'Linked' : 'Unlinked',
        detail: project.repository_url
          ? 'The project record points back to a repository.'
          : 'No repository link is saved on this project yet.',
      },
    ],
  };
}

export function buildProjectKnowledgeOverview(
  project: DashboardProjectRecord,
  spec?: DashboardProjectSpecRecord | null,
): ProjectWorkspaceOverview {
  const configCount = countObjectEntries(spec?.config);
  const instructionCount = countObjectEntries(spec?.instructions);
  const resourceCount = countObjectEntries(spec?.resources);
  const documentCount = countObjectEntries(spec?.documents);
  const toolCount = countObjectEntries(spec?.tools);
  const memoryCount = countObjectEntries(project.memory);

  return {
    summary:
      'Knowledge brings structured spec, resource descriptors, tool policy, shared memory, and artifact inspection into one operator-facing surface.',
    packets: [
      {
        label: 'Structured spec',
        value: `${configCount + instructionCount} entries`,
        detail: `${configCount} config • ${instructionCount} instructions`,
      },
      {
        label: 'Reference assets',
        value: `${resourceCount + documentCount} items`,
        detail: `${resourceCount} resources • ${documentCount} documents`,
      },
      {
        label: 'Tool policy',
        value: `${toolCount} entr${toolCount === 1 ? 'y' : 'ies'}`,
        detail: 'Structured tool allow/block policy stays beside the rest of project knowledge.',
      },
      {
        label: 'Shared memory',
        value: `${memoryCount} entries`,
        detail:
          memoryCount > 0
            ? 'Shared project memory is available without leaving the workspace.'
            : 'No shared memory entries are saved yet.',
      },
      {
        label: 'Artifacts',
        value: 'Inline workspace',
        detail: 'Artifact inspection stays nested here instead of taking another top-level tab.',
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

function getProjectDetailTabOption(value: ProjectDetailTabValue): ProjectDetailTabOption {
  return (
    PROJECT_DETAIL_TAB_OPTIONS.find((option) => option.value === value) ??
    PROJECT_DETAIL_TAB_OPTIONS[0]
  );
}

function countObjectEntries(value: Record<string, unknown> | null | undefined): number {
  return Object.keys(value ?? {}).length;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildProjectDeliveryOverview(project: DashboardProjectRecord): ProjectWorkspaceOverviewPacket {
  const totalWorkflowCount = project.summary?.total_workflow_count ?? 0;
  const activeWorkflowCount = project.summary?.active_workflow_count ?? 0;
  const completedWorkflowCount = project.summary?.completed_workflow_count ?? 0;
  const attentionWorkflowCount = project.summary?.attention_workflow_count ?? 0;
  const detailParts: string[] = [];

  if (activeWorkflowCount > 0) {
    detailParts.push(`${activeWorkflowCount} active`);
  }
  if (completedWorkflowCount > 0) {
    detailParts.push(`${completedWorkflowCount} completed`);
  }
  if (attentionWorkflowCount > 0) {
    detailParts.push(`${attentionWorkflowCount} need attention`);
  }

  if (totalWorkflowCount === 0) {
    return {
      label: 'Delivery',
      value: 'No workflows yet',
      detail:
        'Delivery stays empty until the first workflow lands, then this tab becomes the run timeline and hand-off view.',
    };
  }

  return {
    label: 'Delivery',
    value: `${totalWorkflowCount} workflow${totalWorkflowCount === 1 ? '' : 's'}`,
    detail:
      detailParts.length > 0
        ? `${detailParts.join(' • ')}. Open Delivery for the full timeline.`
        : 'Open Delivery for the full timeline.',
  };
}

function normalizeProjectDescription(description?: string | null): string | null {
  const normalized = description?.trim();
  return normalized ? normalized : null;
}

function formatProjectDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}
