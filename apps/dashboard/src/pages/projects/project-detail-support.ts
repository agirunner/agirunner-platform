import type { DashboardProjectRecord, DashboardProjectSpecRecord } from '../../lib/api.js';

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
      'Adjust project basics, repository defaults, and lifecycle posture.',
  },
  {
    value: 'knowledge',
    label: 'Knowledge',
    description:
      'Group project context, reusable knowledge entries, memory, and run content in one surface.',
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
  const toolCount = countObjectEntries(spec?.tools);
  const knowledgeCount = configCount + toolCount + memoryCount;
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
        detail: `${configCount} curated knowledge • ${memoryCount} memory • ${toolCount} tool policies`,
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
      quickActions: [],
    };
  }

  return {
    mode: 'compact',
    title: project.name,
    description: activeTabOption.description,
    activeTab: activeTabOption,
    contextPills: [],
    quickActions: [],
  };
}

export function buildProjectSettingsOverview(
  project: DashboardProjectRecord,
): ProjectWorkspaceOverview {
  const settings = asRecord(project.settings);

  return {
    summary:
      'Settings is the project control plane: keep project basics, repository defaults, stored settings, and lifecycle posture together before execution.',
    packets: [
      {
        label: 'Stored settings',
        value: `${countObjectEntries(settings)} entries`,
        detail: 'Project-scoped settings saved on the record, including repository defaults and lifecycle configuration.',
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
  const hasProjectContext = readString(asRecord(project.settings).project_brief).trim().length > 0;
  const configCount = countObjectEntries(spec?.config);
  const memoryCount = countObjectEntries(project.memory);

  return {
    summary:
      'Knowledge brings reusable project context, simple knowledge entries, shared memory, and run content into one operator-facing surface.',
    packets: [
      {
        label: 'Project Context',
        value: hasProjectContext ? 'Configured' : 'Not configured',
        detail: hasProjectContext
          ? 'Reusable project context is ready for playbooks that map it into workflow inputs.'
          : 'Add reusable context here when workflows should inherit stable LLM context.',
      },
      {
        label: 'Knowledge entries',
        value: `${configCount} entries`,
        detail:
          configCount > 0
            ? 'Curated project facts and policies are ready for workflows and runtime access by key.'
            : 'No curated knowledge entries are saved yet.',
      },
      {
        label: 'Project artifacts',
        value: 'Inline workspace',
        detail: 'Artifact inspection stays nested here instead of taking another top-level tab.',
      },
      {
        label: 'Shared memory',
        value: `${memoryCount} entries`,
        detail:
          memoryCount > 0
            ? 'Working memory holds evolving notes and learned state without changing the curated knowledge base.'
            : 'No project memory entries are saved yet.',
      },
    ],
  };
}

export function createStructuredEntryDraft(
  valueType: StructuredValueType = 'string',
): StructuredEntryDraft {
  return {
    id: nextDraftId('entry'),
    key: '',
    valueType,
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

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
