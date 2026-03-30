import type {
  DashboardMissionControlWorkflowCard,
  DashboardTaskRecord,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketFileRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import { readOperatorFacingEntries } from '../workflow-operator-input-summary.js';

export function WorkflowDetails(props: {
  workflow: DashboardMissionControlWorkflowCard;
  stickyStrip: DashboardWorkflowStickyStrip | null;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  selectedTaskId: string | null;
  selectedTaskTitle: string | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTask: DashboardTaskRecord | null;
  selectedWorkItemTasks: Record<string, unknown>[];
  inputPackets: DashboardWorkflowInputPacketRecord[];
  workflowParameters: Record<string, unknown> | null;
  scope: WorkflowWorkbenchScopeDescriptor;
}): JSX.Element {
  const normalizedScope = normalizeDetailsScope(props.scope, props.selectedWorkItem, props.selectedWorkItemTitle);
  const selectedWorkItemId = props.selectedWorkItem?.id ?? props.selectedWorkItemId ?? null;
  const isWorkflowScope = normalizedScope.scopeKind === 'workflow';
  const workflowPackets = props.inputPackets.filter((packet) => packet.work_item_id === null);
  const workItemPackets =
    !isWorkflowScope && selectedWorkItemId
      ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
      : [];

  const scope = buildDetailsScope({ ...props, scope: normalizedScope });
  const whatWasAsked = buildWhatWasAsked({
    isWorkflowScope,
    workflowParameters: props.workflowParameters,
    selectedWorkItem: props.selectedWorkItem,
    selectedTask: props.selectedTask,
    workflowPackets,
    workItemPackets,
  });
  const currentState = buildCurrentState({
    isWorkflowScope,
    workflow: props.workflow,
    board: props.board,
    selectedWorkItem: props.selectedWorkItem,
  });
  const whatExistsNow = buildWhatExistsNow({
    isWorkflowScope,
    board: props.board,
    selectedWorkItemTasks: props.selectedWorkItemTasks,
    workflowPackets,
    workItemPackets,
  });

  return (
    <section className="grid gap-4 pb-1">
      <header className="grid gap-1.5">
        <h3 className="text-base font-semibold text-foreground">{scope.title}</h3>
        {scope.workflowName ? (
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {scope.workflowName}
          </p>
        ) : null}
        <p className="text-sm text-foreground">{scope.latestStatus}</p>
      </header>

      <div className="grid gap-4">
        <BriefSection title="What was asked">
          <Narrative paragraphs={whatWasAsked} fallback="No operator brief is attached yet." />
        </BriefSection>

        <BriefSection title="Current state">
          <Narrative paragraphs={currentState} fallback="Current workflow state is still loading." />
        </BriefSection>

        <BriefSection title="What exists now">
          <WhatExistsNowBody rows={whatExistsNow.rows} files={whatExistsNow.files} />
        </BriefSection>
      </div>
    </section>
  );
}

function BriefSection(props: {
  title: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.title}
      </p>
      {props.children}
    </div>
  );
}

function Narrative(props: {
  paragraphs: string[];
  fallback: string;
}): JSX.Element {
  const paragraphs = props.paragraphs.length > 0 ? props.paragraphs : [props.fallback];

  return (
    <div className="grid gap-2">
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-sm leading-6 text-foreground">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function WhatExistsNowBody(props: {
  rows: CompactRow[];
  files: DashboardWorkflowInputPacketFileRecord[];
}): JSX.Element {
  if (props.rows.length === 0 && props.files.length === 0) {
    return <p className="text-sm leading-6 text-muted-foreground">Nothing has been attached to this scope yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {props.rows.length > 0 ? <CompactRowList rows={props.rows} /> : null}
      {props.files.length > 0 ? <PacketFileList files={props.files} /> : null}
    </div>
  );
}

interface CompactRow {
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
}

function CompactRowList(props: { rows: CompactRow[] }): JSX.Element {
  const shouldBoundHeight = props.rows.length > 5;

  return (
    <div className={shouldBoundHeight ? 'max-h-[16rem] overflow-y-auto overscroll-contain pr-1' : undefined}>
      <ul className="grid divide-y divide-border/60">
        {props.rows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm text-foreground">{row.title}</p>
              {row.subtitle ? (
                <p className="text-xs text-muted-foreground">{row.subtitle}</p>
              ) : null}
            </div>
            {row.status ? (
              <span className="shrink-0 text-xs text-muted-foreground">{row.status}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PacketFileList(props: {
  files: DashboardWorkflowInputPacketFileRecord[];
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {props.files.map((file) => (
        <a
          key={file.id}
          className="inline-flex items-center rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
          href={file.download_url}
          target="_blank"
          rel="noreferrer"
        >
          {file.file_name}
        </a>
      ))}
    </div>
  );
}

function buildWhatWasAsked(props: {
  isWorkflowScope: boolean;
  workflowParameters: Record<string, unknown> | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  selectedTask: DashboardTaskRecord | null;
  workflowPackets: DashboardWorkflowInputPacketRecord[];
  workItemPackets: DashboardWorkflowInputPacketRecord[];
}): string[] {
  const paragraphs: string[] = [];

  if (!props.isWorkflowScope) {
    const goal = readSentence(props.selectedWorkItem?.goal);
    if (goal) {
      paragraphs.push(goal);
    }

    const taskInputSummary = summarizeEntries('Task brief', readOperatorFacingEntries(props.selectedTask?.input));
    if (taskInputSummary) {
      paragraphs.push(taskInputSummary);
    }
  }

  if (props.isWorkflowScope) {
    const workflowSummary = summarizeEntries('Workflow brief', readOperatorFacingEntries(props.workflowParameters));
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

function buildCurrentState(props: {
  isWorkflowScope: boolean;
  workflow: DashboardMissionControlWorkflowCard;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
}): string[] {
  if (props.isWorkflowScope) {
    const stateParts = [
      humanizeOptionalToken(props.workflow.state),
      props.workflow.lifecycle ? `${humanizeToken(props.workflow.lifecycle)} lifecycle` : null,
      props.workflow.currentStage ? `${humanizeToken(props.workflow.currentStage)} stage` : null,
      humanizeOptionalToken(props.workflow.posture),
    ].filter((value): value is string => Boolean(value));

    return [joinSentence('This workflow is', stateParts)];
  }

  const lane = resolveBoardColumnLabel(props.board, props.selectedWorkItem?.column_id);
  const workItemStateParts = [
    lane ? `${lane} lane` : null,
    props.selectedWorkItem?.stage_name ? `${humanizeToken(props.selectedWorkItem.stage_name)} stage` : null,
    humanizeOptionalToken(props.selectedWorkItem?.priority)?.toLowerCase()
      ? `${humanizeOptionalToken(props.selectedWorkItem?.priority)?.toLowerCase()} priority`
      : null,
  ].filter((value): value is string => Boolean(value));

  const paragraphs = [joinSentence('This work item is in', workItemStateParts)];
  const nextStep = readSentence(
    props.selectedWorkItem?.blocked_reason
    ?? props.selectedWorkItem?.gate_decision_feedback
    ?? props.selectedWorkItem?.next_expected_action
    ?? null,
  );
  if (nextStep) {
    paragraphs.push(nextStep);
  }
  return paragraphs;
}

function buildWhatExistsNow(props: {
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

  const files = collectPacketFiles([...props.workflowPackets, ...props.workItemPackets]);

  return { rows, files };
}

function buildDetailsScope(props: {
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
      title:
        props.selectedWorkItem?.title ??
        props.selectedWorkItemTitle ??
        'Selected work item',
      latestStatus: buildWorkItemLatestStatus(props.selectedWorkItem, props.selectedWorkItemTasks),
      workflowName: props.workflow.name,
    };
  }

  return {
    title: props.workflow.name,
    latestStatus:
      readSentence(props.stickyStrip?.summary)
      ?? readSentence(props.workflow.pulse.summary)
      ?? 'Workflow is active.',
    workflowName: null,
  };
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
    return `${counts.blockedCount} blocked ${pluralize('task', counts.blockedCount)} need attention.`;
  }
  if (counts?.activeCount) {
    return `${counts.activeCount} active ${pluralize('task', counts.activeCount)} are moving this work item forward.`;
  }
  if (counts?.completedCount) {
    return `${counts.completedCount} completed ${pluralize('task', counts.completedCount)} are already on hand.`;
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

function readCompactWorkItemRows(
  board: DashboardWorkflowBoardResponse | null,
): CompactRow[] {
  if (!board) {
    return [];
  }

  return board.work_items.map((workItem) => ({
    id: workItem.id,
    title: workItem.title,
    subtitle: [
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

function normalizeDetailsScope(
  scope: WorkflowWorkbenchScopeDescriptor,
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null,
  selectedWorkItemTitle: string | null,
): WorkflowWorkbenchScopeDescriptor {
  if (scope.scopeKind !== 'selected_task') {
    return scope;
  }
  const name =
    selectedWorkItem?.title ??
    selectedWorkItemTitle ??
    'Selected work item';
  return {
    scopeKind: 'selected_work_item',
    title: 'Work item',
    subject: 'work item',
    name,
    banner: `Work item: ${name}`,
  };
}
