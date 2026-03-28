import type { ReactNode } from 'react';

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
  const selectedWorkItemId = props.selectedWorkItem?.id ?? props.selectedWorkItemId ?? null;
  const isWorkflowScope = props.scope.scopeKind === 'workflow';
  const isWorkItemScope = props.scope.scopeKind === 'selected_work_item';
  const isTaskScope = props.scope.scopeKind === 'selected_task';
  const workflowPackets = isWorkflowScope
    ? props.inputPackets.filter((packet) => packet.work_item_id === null)
    : [];
  const workItemPackets = isWorkItemScope && selectedWorkItemId
    ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
    : [];
  const scope = buildDetailsScope(props);
  const hasTaskInput = isTaskScope && hasStructuredContent(props.selectedTask?.input);
  const hasInputs =
    workflowPackets.length > 0
    || workItemPackets.length > 0
    || hasTaskInput
    || (isWorkflowScope && hasStructuredContent(props.workflowParameters));

  return (
    <section className="grid gap-3">
      <header className="grid gap-2">
        <h3 className="text-base font-semibold text-foreground">{scope.title}</h3>
        <div className="grid gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Latest status
          </p>
          <p className="text-sm text-muted-foreground">{scope.latest_status}</p>
        </div>
        {scope.summary ? (
          <div className="grid gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Summary
            </p>
            <p className="text-sm text-muted-foreground">{scope.summary}</p>
          </div>
        ) : null}
        {scope.parent_work_item ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Work item</span>
            {' '}
            {scope.parent_work_item}
          </p>
        ) : null}
        {scope.task_summary ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Task summary</span>
            {' '}
            {scope.task_summary}
          </p>
        ) : null}
      </header>

      {hasInputs ? (
        <DetailSection title="Inputs">
          {isWorkflowScope && hasStructuredContent(props.workflowParameters) ? (
            <StructuredBlock label="Workflow parameters" value={props.workflowParameters} />
          ) : null}
          {workflowPackets.length > 0 ? (
            <PacketSection label="Workflow inputs" packets={workflowPackets} />
          ) : null}
          {workItemPackets.length > 0 ? (
            <PacketSection label="Work item inputs" packets={workItemPackets} />
          ) : null}
          {hasTaskInput ? (
            <StructuredBlock label="Task input" value={props.selectedTask?.input ?? null} />
          ) : null}
        </DetailSection>
      ) : null}
    </section>
  );
}

function DetailSection(props: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="grid gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.title}
      </p>
      <div className="grid gap-3">{props.children}</div>
    </section>
  );
}

function PacketSection(props: {
  label: string;
  packets: DashboardWorkflowInputPacketRecord[];
}): JSX.Element {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-semibold text-foreground">{props.label}</p>
      <div className="grid gap-2">
        {props.packets.map((packet) => (
          <div key={packet.id} className="grid gap-2 border-l border-border/70 pl-3">
            <div className="grid gap-1">
              <strong className="text-sm text-foreground">
                {packet.summary ?? humanizeToken(packet.packet_kind)}
              </strong>
              <p className="text-xs text-muted-foreground">
                {humanizeToken(packet.packet_kind)} • {humanizeToken(packet.source)}
              </p>
            </div>
            {hasStructuredContent(packet.structured_inputs) ? (
              <StructuredBlock value={packet.structured_inputs} compact />
            ) : null}
            {packet.files.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {packet.files.map((file) => (
                  <PacketFileLink key={file.id} file={file} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PacketFileLink(props: {
  file: DashboardWorkflowInputPacketFileRecord;
}): JSX.Element {
  return (
    <a
      className="inline-flex items-center rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
      href={props.file.download_url}
      target="_blank"
      rel="noreferrer"
    >
      {props.file.file_name}
    </a>
  );
}

function StructuredBlock(props: {
  label?: string;
  value: unknown;
  compact?: boolean;
}): JSX.Element {
  const entries = readStructuredEntries(props.value);
  const rendered = readStructuredPreview(props.value);
  if (entries.length === 0 && !rendered) {
    return <></>;
  }

  return (
    <div className="grid gap-2">
      {props.label ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {props.label}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <dl className="divide-y divide-border/60 rounded-xl border border-border/70 bg-background/70">
          {entries.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-3">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </dt>
              <dd className={props.compact ? 'text-xs text-foreground' : 'text-sm text-foreground'}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : rendered ? (
        <pre
          className={
            props.compact
              ? 'overflow-x-auto rounded-xl border border-border/70 bg-background/80 p-3 text-xs text-foreground'
              : 'overflow-x-auto rounded-xl border border-border/70 bg-background/80 p-3 text-sm text-foreground'
          }
        >
          {rendered}
        </pre>
      ) : null}
    </div>
  );
}

function buildDetailsScope(props: {
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
  scope: WorkflowWorkbenchScopeDescriptor;
}): {
  title: string;
  latest_status: string;
  summary: string | null;
  parent_work_item: string | null;
  task_summary: string | null;
} {
  if (props.scope.scopeKind === 'selected_task') {
    return {
      title:
        props.selectedTask?.title
        ?? props.selectedTaskTitle
        ?? props.selectedTaskId
        ?? 'Selected task',
      latest_status: buildTaskLatestStatus(props.selectedTask),
      summary: readOptionalText(props.selectedTask?.description),
      parent_work_item:
        props.selectedWorkItem?.title
        ?? props.selectedTask?.work_item_title
        ?? props.selectedWorkItemTitle
        ?? null,
      task_summary: null,
    };
  }

  if (props.scope.scopeKind === 'selected_work_item') {
    return {
      title:
        props.selectedWorkItem?.title
        ?? props.selectedWorkItemTitle
        ?? props.selectedWorkItemId
        ?? 'Selected work item',
      latest_status: buildWorkItemLatestStatus(props.selectedWorkItem, props.selectedWorkItemTasks),
      summary:
        readOptionalText(props.selectedWorkItem?.goal)
        ?? readOptionalText(props.selectedWorkItem?.acceptance_criteria),
      parent_work_item: null,
      task_summary: buildTaskSummary(props.selectedWorkItemTasks),
    };
  }

  return {
    title: props.workflow.name,
    latest_status:
      readOptionalText(props.stickyStrip?.summary)
      ?? readOptionalText(props.workflow.pulse.summary)
      ?? 'Workflow is active.',
    summary: null,
    parent_work_item: null,
    task_summary: null,
  };
}

function buildTaskLatestStatus(task: DashboardTaskRecord | null): string {
  if (!task) {
    return 'Task details are loading.';
  }
  const parts = [humanizeToken(task.state)];
  const role = readOptionalText(task.role);
  if (role) {
    parts.push(`for ${humanizeToken(role)}`);
  }
  return parts.join(' ');
}

function buildWorkItemLatestStatus(
  workItem: DashboardWorkflowWorkItemRecord | null,
  tasks: Record<string, unknown>[],
): string {
  const blockedReason =
    readOptionalText(workItem?.blocked_reason) ?? readOptionalText(workItem?.gate_decision_feedback);
  if (blockedReason) {
    return blockedReason;
  }
  const summary = buildTaskSummary(tasks);
  return summary ? `Current task load: ${summary}.` : 'Work item details are loading.';
}

function buildTaskSummary(tasks: Record<string, unknown>[]): string | null {
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

  const segments = [
    `${activeCount} active`,
    `${blockedCount} blocked`,
    `${completedCount} completed`,
  ];
  return segments.join(' • ');
}

function hasStructuredContent(value: unknown): boolean {
  return readStructuredPreview(value) !== null;
}

function readStructuredPreview(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const rendered = JSON.stringify(value, null, 2);
  return rendered === '{}' ? null : rendered;
}

function readStructuredEntries(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const rendered: Array<[string, string]> = [];
  for (const [key, entryValue] of entries) {
    const text = renderStructuredValue(entryValue);
    if (!text) {
      continue;
    }
    rendered.push([humanizeToken(key), text]);
  }
  return rendered;
}

function renderStructuredValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => renderStructuredValue(entry))
      .filter((entry): entry is string => Boolean(entry));
    return items.length > 0 ? items.join(' • ') : null;
  }
  return null;
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function isBlockedState(state: string): boolean {
  return state === 'blocked' || state === 'waiting' || state === 'needs_attention';
}

function isCompletedState(state: string): boolean {
  return state === 'completed' || state === 'done' || state === 'succeeded';
}
