import type { DashboardWorkspaceRecord } from '../../lib/api.js';

export const WORKSPACE_DETAIL_TAB_OPTIONS = [
  {
    value: 'overview',
    label: 'Overview',
    description:
      'Start with workspace posture, knowledge depth, and storage readiness.',
  },
  {
    value: 'settings',
    label: 'Settings',
    description:
      'Adjust workspace basics, storage configuration, and lifecycle posture.',
  },
  {
    value: 'knowledge',
    label: 'Knowledge',
    description:
      'Group workspace artifacts and shared memory in one surface.',
  },
] as const;

export type WorkspaceDetailTabValue = (typeof WORKSPACE_DETAIL_TAB_OPTIONS)[number]['value'];
export type WorkspaceDetailTabOption = (typeof WORKSPACE_DETAIL_TAB_OPTIONS)[number];

export interface WorkspaceOverviewPacket {
  label: string;
  value: string;
  detail: string;
}

export interface WorkspaceOverview {
  summary: string;
  packets: WorkspaceOverviewPacket[];
}

export interface WorkspaceDetailHeaderAction {
  label: string;
  href: string;
  variant: 'secondary' | 'outline' | 'ghost';
}

export interface WorkspaceDetailHeaderState {
  mode: 'expanded' | 'compact';
  title: string;
  description: string;
  activeTab: WorkspaceDetailTabOption;
  contextPills: string[];
  quickActions: WorkspaceDetailHeaderAction[];
}

export type StructuredValueType = 'string' | 'number' | 'boolean' | 'json';

export interface StructuredEntryDraft {
  id: string;
  key: string;
  valueType: StructuredValueType;
  value: string;
}

let draftCounter = 0;

export function normalizeWorkspaceDetailTab(value: string | null | undefined): WorkspaceDetailTabValue {
  const normalized = value?.trim() ?? '';
  return WORKSPACE_DETAIL_TAB_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as WorkspaceDetailTabValue)
    : 'overview';
}

export function buildWorkspaceOverview(
  workspace: DashboardWorkspaceRecord,
): WorkspaceOverview {
  const memoryCount = countObjectEntries(workspace.memory);
  const updatedLabel = formatWorkspaceDateTime(workspace.updated_at);

  return {
    summary:
      'Use this snapshot to confirm lifecycle, storage posture, and shared memory before switching workspaces.',
    packets: [
      {
        label: 'Lifecycle',
        value: workspace.is_active ? 'Active' : 'Inactive',
        detail:
          updatedLabel === '-'
            ? 'Workspace activity state is available, but no recent update timestamp is recorded.'
            : `Last updated ${updatedLabel}.`,
      },
      {
        label: 'Shared memory',
        value: `${memoryCount} ${memoryCount === 1 ? 'entry' : 'entries'}`,
        detail:
          memoryCount > 0
            ? 'Workspace memory keeps evolving notes and learned state available between runs.'
            : 'No workspace memory entries are saved yet.',
      },
      {
        label: 'Storage',
        value: readWorkspaceStorageLabel(workspace),
        detail: describeWorkspaceStorage(workspace),
      },
    ],
  };
}

export function buildWorkspaceDetailHeaderState(
  workspace: DashboardWorkspaceRecord,
  activeTab: WorkspaceDetailTabValue,
): WorkspaceDetailHeaderState {
  const activeTabOption = getWorkspaceDetailTabOption(activeTab);
  if (activeTab === 'overview') {
    return {
      mode: 'expanded',
      title: workspace.name,
      description:
        'Use this workspace to move between settings and knowledge without losing context.',
      activeTab: activeTabOption,
      contextPills: [],
      quickActions: [],
    };
  }

  return {
    mode: 'compact',
    title: workspace.name,
    description: activeTabOption.description,
    activeTab: activeTabOption,
    contextPills: [],
    quickActions: [],
  };
}

export function buildWorkspaceSettingsOverview(
  workspace: DashboardWorkspaceRecord,
): WorkspaceOverview {
  const settings = asRecord(workspace.settings);

  return {
    summary:
      'Settings is the workspace control plane: keep workspace basics, storage configuration, stored settings, and lifecycle posture together before execution.',
    packets: [
      {
        label: 'Stored settings',
        value: `${countObjectEntries(settings)} entries`,
        detail: 'Workspace-scoped settings saved on the record, including storage configuration and lifecycle posture.',
      },
      {
        label: 'Workspace storage',
        value: readWorkspaceStorageLabel(workspace),
        detail: describeWorkspaceStorage(workspace),
      },
    ],
  };
}

export function buildWorkspaceKnowledgeOverview(
  workspace: DashboardWorkspaceRecord,
): WorkspaceOverview {
  const memoryCount = countObjectEntries(workspace.memory);

  return {
    summary:
      'Knowledge keeps workspace-owned artifacts and shared memory in one operator-facing surface.',
    packets: [
      {
        label: 'Workspace artifacts',
        value: 'Inline workspace',
        detail: 'Artifact inspection stays nested here instead of taking another top-level tab.',
      },
      {
        label: 'Shared memory',
        value: `${memoryCount} entries`,
        detail:
          memoryCount > 0
            ? 'Working memory holds evolving notes and learned state without leaving the workspace surface.'
            : 'No workspace memory entries are saved yet.',
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

function getWorkspaceDetailTabOption(value: WorkspaceDetailTabValue): WorkspaceDetailTabOption {
  return (
    WORKSPACE_DETAIL_TAB_OPTIONS.find((option) => option.value === value) ??
    WORKSPACE_DETAIL_TAB_OPTIONS[0]
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

export function readWorkspaceStorageLabel(workspace: DashboardWorkspaceRecord): string {
  const settings = asRecord(workspace.settings);
  const storageType = readString(settings.workspace_storage_type);
  switch (storageType) {
    case 'git_remote':
      return 'Git Remote';
    case 'host_directory':
      return 'Host Directory';
    case 'workspace_artifacts':
      return 'Workspace Artifacts';
    default:
      return workspace.repository_url ? 'Git Remote' : 'Workspace Artifacts';
  }
}

function describeWorkspaceStorage(workspace: DashboardWorkspaceRecord): string {
  const settings = asRecord(workspace.settings);
  const storage = asRecord(settings.workspace_storage);
  const storageLabel = readWorkspaceStorageLabel(workspace);
  if (storageLabel === 'Git Remote') {
    const repositoryUrl = readString(storage.repository_url) || readString(workspace.repository_url);
    return repositoryUrl
      ? `Repository execution is pinned to ${repositoryUrl}.`
      : 'Repository execution is configured on the workspace.';
  }
  if (storageLabel === 'Host Directory') {
    const hostPath = readString(storage.host_path);
    return hostPath
      ? `Specialist executions mount ${hostPath} directly from the host machine.`
      : 'Specialist executions mount a host directory configured on the workspace.';
  }
  return 'Persistence happens through uploaded workspace artifacts instead of a shared repository checkout.';
}

function formatWorkspaceDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
}
