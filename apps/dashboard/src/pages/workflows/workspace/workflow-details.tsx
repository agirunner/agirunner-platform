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
  const operatorFacingTaskInput = isTaskScope ? readOperatorFacingTaskInput(props.selectedTask?.input) : null;
  const shouldShowParentWorkItemInputs =
    selectedWorkItemId !== null && (isWorkItemScope || isTaskScope);
  const workItemPackets = shouldShowParentWorkItemInputs && selectedWorkItemId
    ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
    : [];
  const scope = buildDetailsScope(props);
  const hasTaskInput = isTaskScope && hasStructuredContent(operatorFacingTaskInput);
  const hasInputs =
    workflowPackets.length > 0
    || workItemPackets.length > 0
    || hasTaskInput
    || (isWorkflowScope && hasStructuredContent(props.workflowParameters));
  const scopeLabel = readScopeLabel(props.scope.scopeKind);
  const detailLines = buildDetailLines(scope);

  return (
    <section className="grid gap-3 pb-1">
      <header className="grid gap-1 border-b border-border/60 pb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{scopeLabel}</p>
        <h3 className="text-base font-semibold text-foreground">{scope.title}</h3>
        {scope.summary ? (
          <p className="text-sm text-muted-foreground">{scope.summary}</p>
        ) : null}
        {detailLines.length > 0 ? (
          <div className="grid gap-1 text-sm text-muted-foreground">
            {detailLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        ) : null}
      </header>

      {hasInputs ? (
        <DetailSection title="Inputs">
          {isWorkflowScope && hasStructuredContent(props.workflowParameters) ? (
            <StructuredBlock label="Launch inputs" value={props.workflowParameters} />
          ) : null}
          {workflowPackets.length > 0 ? (
            <PacketSection packets={workflowPackets} />
          ) : null}
          {workItemPackets.length > 0 ? (
            <PacketSection packets={workItemPackets} />
          ) : null}
          {hasTaskInput ? (
            <StructuredBlock label="Task input" value={operatorFacingTaskInput} />
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
    <section className="grid gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.title}
      </p>
      <div className="grid gap-3">{props.children}</div>
    </section>
  );
}

function PacketSection(props: {
  packets: DashboardWorkflowInputPacketRecord[];
}): JSX.Element {
  return (
    <div className="grid gap-3 divide-y divide-border/60">
      {props.packets.map((packet) => (
        <div key={packet.id} className="grid gap-2 pt-3 first:pt-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong className="text-sm text-foreground">
              {packet.summary ?? humanizeToken(packet.packet_kind)}
            </strong>
            <span className="text-xs text-muted-foreground">
              {humanizeToken(packet.packet_kind)}
              {' input'}
            </span>
          </div>
          {hasStructuredContent(packet.structured_inputs) ? (
            <StructuredBlock value={packet.structured_inputs} compact />
          ) : null}
          {packet.files.length > 0 ? (
            <div className="grid gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Attached files
              </p>
              <div className="flex flex-wrap gap-2">
              {packet.files.map((file) => (
                <PacketFileLink key={file.id} file={file} />
              ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PacketFileLink(props: {
  file: DashboardWorkflowInputPacketFileRecord;
}): JSX.Element {
  return (
    <a
      className="inline-flex items-center rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-accent underline-offset-4 hover:underline"
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
        <dl className="divide-y divide-border/60">
          {entries.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-3">
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
              ? 'overflow-x-auto rounded-md border border-border/70 p-2 text-xs text-foreground'
              : 'overflow-x-auto rounded-md border border-border/70 p-2 text-sm text-foreground'
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
  workflow_name: string | null;
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
      workflow_name: props.workflow.name,
      summary:
        readOptionalText(props.selectedWorkItem?.goal)
        ?? readOptionalText(props.selectedWorkItem?.acceptance_criteria)
        ?? readOptionalText(props.selectedTask?.description),
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
      workflow_name: props.workflow.name,
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
    workflow_name: null,
    summary: null,
    parent_work_item: null,
    task_summary: null,
  };
}

function buildDetailLines(input: {
  latest_status: string;
  workflow_name: string | null;
  parent_work_item: string | null;
  task_summary: string | null;
}): string[] {
  const lines: string[] = [];
  if (input.workflow_name) {
    lines.push(`Workflow: ${input.workflow_name}`);
  }
  if (input.parent_work_item) {
    lines.push(`Work item: ${input.parent_work_item}`);
  }
  lines.push(input.latest_status);
  if (input.task_summary) {
    lines.push(input.task_summary);
  }
  return lines.filter((line) => line.trim().length > 0);
}

function readScopeLabel(scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind']): string {
  if (scopeKind === 'selected_task') {
    return 'Task';
  }
  if (scopeKind === 'selected_work_item') {
    return 'Work item';
  }
  return 'Workflow';
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
  return buildTaskHeadline(tasks) ?? 'Work item details are loading.';
}

function buildTaskSummary(tasks: Record<string, unknown>[]): string | null {
  const counts = readTaskCounts(tasks);
  if (!counts) {
    return null;
  }
  const segments = [
    `${counts.activeCount} active`,
    `${counts.blockedCount} blocked`,
    `${counts.completedCount} completed`,
  ];
  return segments.join(' • ');
}

function buildTaskHeadline(tasks: Record<string, unknown>[]): string | null {
  const counts = readTaskCounts(tasks);
  if (!counts) {
    return null;
  }
  if (counts.blockedCount > 0) {
    return `${counts.blockedCount} blocked ${pluralize('task', counts.blockedCount)}`;
  }
  if (counts.activeCount > 0) {
    return `${counts.activeCount} active ${pluralize('task', counts.activeCount)}`;
  }
  return `${counts.completedCount} completed ${pluralize('task', counts.completedCount)}`;
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
    rendered.push([humanizeStructuredLabel(key), text]);
  }
  return rendered;
}

function readOperatorFacingTaskInput(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const filtered = filterOperatorFacingInputRecord(value as Record<string, unknown>);
  return Object.keys(filtered).length > 0 ? filtered : null;
}

function filterOperatorFacingInputRecord(value: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (!shouldRenderOperatorFacingTaskInputKey(key)) {
      continue;
    }
    const normalizedValue = normalizeOperatorFacingTaskInputValue(entryValue);
    if (normalizedValue === null) {
      continue;
    }
    filtered[key] = normalizedValue;
  }
  return filtered;
}

function shouldRenderOperatorFacingTaskInputKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (
    normalized === 'subject_revision'
    || normalized === 'activation_id'
    || normalized === 'execution_context_id'
  ) {
    return false;
  }
  if (normalized.endsWith('_id') || normalized.endsWith('_ids')) {
    return false;
  }
  return true;
}

function normalizeOperatorFacingTaskInputValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value.trim() : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => normalizeOperatorFacingTaskInputValue(entry))
      .filter((entry): entry is string | number | boolean => entry !== null);
    return items.length > 0 ? items : null;
  }
  return null;
}

function renderStructuredValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? humanizeStructuredText(trimmed) : null;
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

function humanizeStructuredLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'deliverable') {
    return 'Requested deliverable';
  }
  if (normalized === 'acceptance_criteria') {
    return 'Success criteria';
  }
  return humanizeToken(value);
}

function humanizeStructuredText(value: string): string {
  if (!looksLikeMachineToken(value)) {
    return value;
  }
  return humanizeToken(value);
}

function looksLikeMachineToken(value: string): boolean {
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/i.test(value);
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
