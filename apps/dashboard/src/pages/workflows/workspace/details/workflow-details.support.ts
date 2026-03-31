import type {
  DashboardMissionControlWorkflowCard,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketFileRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../../workflows-page.support.js';
import { readOperatorFacingEntries } from '../../workflow-operator-input-summary.js';

export interface CompactRow {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
}

export function buildWhatWasAsked(props: {
  isWorkflowScope: boolean;
  workflowParameters: Record<string, unknown> | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  workflowPackets: DashboardWorkflowInputPacketRecord[];
  workItemPackets: DashboardWorkflowInputPacketRecord[];
}): string[] {
  const paragraphs: string[] = [];

  if (!props.isWorkflowScope) {
    const goal = readSentence(props.selectedWorkItem?.goal);
    if (goal) {
      paragraphs.push(goal);
    }

    const taskInputSummaries = readTaskInputSummaries(props.selectedWorkItemTasks);
    for (const taskInputSummary of taskInputSummaries) {
      paragraphs.push(taskInputSummary);
    }
  }

  if (props.isWorkflowScope) {
    const workflowSummary = summarizeEntries(
      'Workflow brief',
      readOperatorFacingEntries(props.workflowParameters),
    );
    if (workflowSummary) {
      paragraphs.push(workflowSummary);
    }
  }

  for (const packet of [...props.workflowPackets, ...props.workItemPackets]) {
    const packetSummary = summarizePacket(packet);
    if (packetSummary) {
      paragraphs.push(packetSummary);
    }
  }

  return paragraphs;
}

export function buildCurrentState(props: {
  isWorkflowScope: boolean;
  workflow: DashboardMissionControlWorkflowCard;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
}): string[] {
  if (props.isWorkflowScope) {
    const stateParts = [
      humanizeOptionalToken(props.workflow.state),
      props.workflow.lifecycle
        ? `${humanizeToken(props.workflow.lifecycle)} lifecycle`
        : null,
      humanizeOptionalToken(props.workflow.posture),
    ].filter((value): value is string => Boolean(value));

    const paragraphs = [joinSentence('This workflow is', stateParts)];
    const activeWorkItemStages = summarizeActiveWorkItemStages(props.board);
    if (activeWorkItemStages) {
      paragraphs.push(activeWorkItemStages);
    }
    return paragraphs;
  }

  const lane = resolveBoardColumnLabel(props.board, props.selectedWorkItem?.column_id);
  const workItemStateParts = [
    lane ? `${lane} lane` : null,
    props.selectedWorkItem?.stage_name
      ? `${humanizeToken(props.selectedWorkItem.stage_name)} stage`
      : null,
    humanizeOptionalToken(props.selectedWorkItem?.priority)?.toLowerCase()
      ? `${humanizeOptionalToken(props.selectedWorkItem?.priority)?.toLowerCase()} priority`
      : null,
  ].filter((value): value is string => Boolean(value));

  const paragraphs = [joinSentence('This work item is in', workItemStateParts)];
  const nextStep = readSentence(
    props.selectedWorkItem?.blocked_reason ??
      props.selectedWorkItem?.gate_decision_feedback ??
      props.selectedWorkItem?.next_expected_action ??
      null,
  );
  if (nextStep) {
    paragraphs.push(nextStep);
  }
  return paragraphs;
}

export function buildWhatExistsNow(props: {
  isWorkflowScope: boolean;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  workflowPackets: DashboardWorkflowInputPacketRecord[];
  workItemPackets: DashboardWorkflowInputPacketRecord[];
}): {
  rows: CompactRow[];
  files: DashboardWorkflowInputPacketFileRecord[];
} {
  const rows = props.isWorkflowScope
    ? readCompactWorkItemRows(props.board)
    : readCompactTaskRows(props.selectedWorkItemTasks);
  const files = props.isWorkflowScope
    ? collectPacketFiles(props.workflowPackets)
    : collectPacketFiles(props.workItemPackets);

  return { rows, files };
}

export function buildDetailsScope(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  selectedWorkItemTitle: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  scope: WorkflowWorkbenchScopeDescriptor;
}): {
  title: string;
  latestStatus: string;
  workflowName: string | null;
} {
  if (props.scope.scopeKind !== 'workflow') {
    return {
      title: `Work item · ${
        props.selectedWorkItem?.title ??
        props.selectedWorkItemTitle ??
        'Selected work item'
      }`,
      latestStatus: buildWorkItemLatestStatus(
        props.selectedWorkItem,
        props.selectedWorkItemTasks,
      ),
      workflowName: props.workflow.name,
    };
  }

  return {
    title: `Workflow · ${props.workflow.name}`,
    latestStatus:
      readSentence(props.stickyStrip?.summary) ??
      readSentence(props.workflow.pulse.summary) ??
      'Workflow is active.',
    workflowName: null,
  };
}

export function normalizeDetailsScope(
  scope: WorkflowWorkbenchScopeDescriptor,
): WorkflowWorkbenchScopeDescriptor {
  return scope;
}

function buildWorkItemLatestStatus(
  workItem: DashboardWorkflowWorkItemRecord | null,
  tasks: Record<string, unknown>[],
): string {
  const blockedReason =
    readSentence(workItem?.blocked_reason) ??
    readSentence(workItem?.gate_decision_feedback);
  if (blockedReason) {
    return blockedReason;
  }

  const counts = readTaskCounts(tasks);
  if (counts?.blockedCount) {
    return `${counts.blockedCount} blocked ${pluralize(
      'task',
      counts.blockedCount,
    )} need attention.`;
  }
  if (counts?.activeCount) {
    return `${counts.activeCount} active ${pluralize(
      'task',
      counts.activeCount,
    )} are moving this work item forward.`;
  }
  if (counts?.completedCount) {
    return `${counts.completedCount} completed ${pluralize(
      'task',
      counts.completedCount,
    )} are already on hand.`;
  }

  return readSentence(workItem?.next_expected_action) ?? 'Work item details are loading.';
}

function readTaskCounts(tasks: Record<string, unknown>[]): {
  activeCount: number;
  blockedCount: number;
  completedCount: number;
} | null {
  if (tasks.length === 0) {
    return null;
  }

  let activeCount = 0;
  let blockedCount = 0;
  let completedCount = 0;

  for (const task of tasks) {
    const state = typeof task.state === 'string' ? task.state.trim().toLowerCase() : '';
    if (isCompletedState(state)) {
      completedCount += 1;
      continue;
    }
    if (isBlockedState(state)) {
      blockedCount += 1;
      continue;
    }
    activeCount += 1;
  }

  return {
    activeCount,
    blockedCount,
    completedCount,
  };
}

function readTaskInputSummaries(tasks: Record<string, unknown>[]): string[] {
  return tasks
    .map((task) => {
      const title = readOptionalText(task.title) ?? 'Task brief';
      return summarizeEntries(title, readOperatorFacingEntries(readTaskInput(task)));
    })
    .filter((summary): summary is string => Boolean(summary));
}

function readTaskInput(task: Record<string, unknown>): Record<string, unknown> | null {
  const input = task.input;
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
}

function readCompactWorkItemRows(
  board: DashboardWorkflowBoardResponse | null,
): CompactRow[] {
  if (!board) {
    return [];
  }

  return board.work_items.map((workItem) => ({
    id: workItem.id,
    title: workItem.title,
    subtitle:
      [
        workItem.stage_name ? `${humanizeToken(workItem.stage_name)} stage` : null,
        resolveBoardColumnLabel(board, workItem.column_id)
          ? `${resolveBoardColumnLabel(board, workItem.column_id)} lane`
          : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join(' • ') || null,
    status:
      typeof workItem.task_count === 'number'
        ? `${workItem.task_count} ${pluralize('task', workItem.task_count)}`
        : humanizeOptionalToken(workItem.priority),
  }));
}

function readCompactTaskRows(tasks: Record<string, unknown>[]): CompactRow[] {
  return tasks
    .map((task, index) => {
      const id = readOptionalText(task.id) ?? `task-${index}`;
      const title = readOptionalText(task.title) ?? id;
      const role = humanizeOptionalToken(readOptionalText(task.role));
      const state = humanizeToken(readOptionalText(task.state) ?? 'pending');
      return {
        id,
        title,
        subtitle: role,
        status: state,
      };
    })
    .filter((task) => task.title.trim().length > 0);
}

function collectPacketFiles(
  packets: DashboardWorkflowInputPacketRecord[],
): DashboardWorkflowInputPacketFileRecord[] {
  const files = new Map<string, DashboardWorkflowInputPacketFileRecord>();

  for (const packet of packets) {
    for (const file of packet.files) {
      files.set(file.id, file);
    }
  }

  return [...files.values()];
}

function summarizeActiveWorkItemStages(board: DashboardWorkflowBoardResponse | null): string | null {
  if (!board || board.active_stages.length === 0) {
    return null;
  }
  const stageLabels = board.active_stages.map((stage) => humanizeToken(stage));
  if (stageLabels.length === 1) {
    return `Active work items are currently in ${stageLabels[0]} stage.`;
  }
  return `Active work items are currently in ${joinWithAnd(stageLabels)} stages.`;
}

function summarizePacket(packet: DashboardWorkflowInputPacketRecord): string | null {
  const entrySummary = summarizeEntries(
    packet.summary ?? humanizeToken(packet.packet_kind),
    readOperatorFacingEntries(packet.structured_inputs),
  );

  if (entrySummary) {
    return entrySummary;
  }

  const packetLabel = readOptionalText(packet.summary) ?? humanizeToken(packet.packet_kind);
  return packet.files.length > 0 ? `${packetLabel} is attached for reference.` : null;
}

function summarizeEntries(
  prefix: string,
  entries: Array<[string, string]>,
): string | null {
  if (entries.length === 0) {
    return null;
  }

  const body = entries.map(([label, value]) => `${label}: ${value}`).join('; ');
  return `${prefix}: ${body}.`;
}

function joinSentence(prefix: string, parts: string[]): string {
  if (parts.length === 0) {
    return `${prefix} progress is still loading.`;
  }
  return `${prefix} ${parts.join(', ')}.`;
}

function joinWithAnd(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function readSentence(value: string | null | undefined): string | null {
  const text = readOptionalText(value);
  if (!text) {
    return null;
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeOptionalToken(value: string | null | undefined): string | null {
  return value ? humanizeToken(value) : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function resolveBoardColumnLabel(
  board: DashboardWorkflowBoardResponse | null,
  columnId: string | null | undefined,
): string | null {
  if (!board || !columnId) {
    return null;
  }
  return board.columns.find((column) => column.id === columnId)?.label ?? null;
}

function pluralize(value: string, count: number): string {
  return count === 1 ? value : `${value}s`;
}

function isBlockedState(state: string): boolean {
  return state === 'blocked' || state === 'waiting' || state === 'needs_attention';
}

function isCompletedState(state: string): boolean {
  return state === 'completed' || state === 'done' || state === 'succeeded';
}
