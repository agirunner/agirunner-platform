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
  const isWorkItemScope = !isWorkflowScope;
  const workflowPackets = props.inputPackets.filter((packet) => packet.work_item_id === null);
  const shouldShowParentWorkItemInputs = isWorkItemScope && Boolean(selectedWorkItemId);
  const compactTaskRows = isWorkItemScope ? readCompactTaskRows(props.selectedWorkItemTasks) : [];
  const workItemPackets =
    shouldShowParentWorkItemInputs && selectedWorkItemId
      ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
      : [];
  const scope = buildDetailsScope({ ...props, scope: normalizedScope });
  const basicEntries = buildBasicEntries({ ...props, board: props.board, scope: normalizedScope });
  const inputGroups = buildInputGroups({
    isWorkflowScope,
    selectedTask: props.selectedTask,
    workflowParameters: props.workflowParameters,
    workflowPackets,
    workItemPackets,
  });
  const hasTaskDetails = compactTaskRows.length > 0;

  return (
    <section className="grid gap-3 pb-1">
      <header className="grid gap-1.5 border-b border-border/60 pb-2">
        <h3 className="text-base font-semibold text-foreground">{scope.title}</h3>
        {scope.workflow_name ? (
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {scope.workflow_name}
          </p>
        ) : null}
        <p className="text-sm text-foreground">{scope.latest_status}</p>
        {scope.context ? (
          <p className="text-sm text-muted-foreground">{scope.context}</p>
        ) : null}
      </header>

      {basicEntries.length > 0 ? (
        <DetailSection title="Basics">
          <EntryList entries={basicEntries} />
        </DetailSection>
      ) : null}

      {inputGroups.length > 0 ? (
        <DetailSection title="Inputs">
          <div className="grid gap-3">
            {inputGroups.map((group) => (
              <InputGroup
                key={group.key}
                title={group.title}
                entries={group.entries}
                files={group.files}
              />
            ))}
          </div>
        </DetailSection>
      ) : null}

      {isWorkItemScope && hasTaskDetails ? (
        <DetailSection title="Tasks">
          <CompactTaskList tasks={compactTaskRows} />
        </DetailSection>
      ) : null}
    </section>
  );
}

function DetailSection(props: {
  title: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="grid gap-2 border-t border-border/60 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.title}
      </p>
      {props.children}
    </div>
  );
}

function InputGroup(props: {
  title: string;
  entries: Array<[string, string]>;
  files: DashboardWorkflowInputPacketFileRecord[];
}): JSX.Element {
  if (props.entries.length === 0 && props.files.length === 0) {
    return <></>;
  }

  return (
    <div className="grid gap-1.5 border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
      <strong className="text-sm text-foreground">{props.title}</strong>
      {props.entries.length > 0 ? <EntryList entries={props.entries} compact /> : null}
      {props.files.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Attached files
          </p>
          <div className="flex flex-wrap gap-2">
            {props.files.map((file) => (
              <PacketFileLink key={file.id} file={file} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PacketFileLink(props: { file: DashboardWorkflowInputPacketFileRecord }): JSX.Element {
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

function EntryList(props: {
  entries: Array<[string, string]>;
  compact?: boolean;
}): JSX.Element {
  if (props.entries.length === 0) {
    return <></>;
  }

  return (
    <div className="grid gap-1.5">
      <dl className="divide-y divide-border/60">
        {props.entries.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-1 py-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-2.5"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </dt>
            <dd className={props.compact ? 'text-xs text-foreground' : 'text-sm text-foreground'}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CompactTaskList(props: {
  tasks: Array<{
    id: string;
    title: string;
    role: string | null;
    state: string;
  }>;
}): JSX.Element {
  if (props.tasks.length === 0) {
    return <></>;
  }

  const shouldBoundHeight = props.tasks.length > 5;

  return (
    <div
      className={
        shouldBoundHeight
          ? 'max-h-[16rem] overflow-y-auto overscroll-contain rounded-md border border-border/60 bg-muted/5 p-1.5'
          : undefined
      }
    >
      <ul className="grid divide-y divide-border/60">
        {props.tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{task.title}</p>
              {task.role ? (
                <p className="text-xs text-muted-foreground">{task.role}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{task.state}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildBasicEntries(props: {
  workflow: DashboardMissionControlWorkflowCard;
  board: DashboardWorkflowBoardResponse | null;
  selectedWorkItem: DashboardWorkflowWorkItemRecord | null;
  scope: WorkflowWorkbenchScopeDescriptor;
}): Array<[string, string]> {
  if (props.scope.scopeKind === 'workflow') {
    return [
      readBasicEntry('Workflow state', humanizeOptionalToken(props.workflow.state)),
      readBasicEntry('Lifecycle', humanizeOptionalToken(props.workflow.lifecycle)),
      readBasicEntry('Active stage', humanizeOptionalToken(props.workflow.currentStage)),
      readBasicEntry('Posture', humanizeOptionalToken(props.workflow.posture)),
    ].filter((entry): entry is [string, string] => Boolean(entry));
  }

  return [
    readBasicEntry('Stage', humanizeOptionalToken(props.selectedWorkItem?.stage_name ?? null)),
    readBasicEntry(
      'Lane',
      resolveBoardColumnLabel(props.board, props.selectedWorkItem?.column_id)
      ?? humanizeOptionalToken(props.selectedWorkItem?.column_id ?? null),
    ),
    readBasicEntry('Priority', humanizeOptionalToken(props.selectedWorkItem?.priority ?? null)),
  ].filter((entry): entry is [string, string] => Boolean(entry));
}

function buildInputGroups(props: {
  isWorkflowScope: boolean;
  selectedTask: DashboardTaskRecord | null;
  workflowParameters: Record<string, unknown> | null;
  workflowPackets: DashboardWorkflowInputPacketRecord[];
  workItemPackets: DashboardWorkflowInputPacketRecord[];
}): Array<{
  key: string;
  title: string;
  entries: Array<[string, string]>;
  files: DashboardWorkflowInputPacketFileRecord[];
}> {
  const groups: Array<{
    key: string;
    title: string;
    entries: Array<[string, string]>;
    files: DashboardWorkflowInputPacketFileRecord[];
  }> = [];

  const launchInputEntries = props.isWorkflowScope
    ? readOperatorFacingEntries(props.workflowParameters)
    : [];
  if (launchInputEntries.length > 0) {
    groups.push({
      key: 'launch-inputs',
      title: 'Launch inputs',
      entries: launchInputEntries,
      files: [],
    });
  }

  const selectedTaskInputEntries = !props.isWorkflowScope && props.selectedTask
    ? readOperatorFacingEntries(props.selectedTask.input)
    : [];
  if (
    selectedTaskInputEntries.length > 0
    && !shouldSuppressSelectedTaskInputGroup(props.selectedTask?.input, selectedTaskInputEntries)
  ) {
    groups.push({
      key: 'current-task-input',
      title: 'Current task input',
      entries: selectedTaskInputEntries,
      files: [],
    });
  }

  for (const packet of props.workflowPackets) {
    groups.push({
      key: packet.id,
      title: packet.summary ?? humanizeToken(packet.packet_kind),
      entries: readOperatorFacingEntries(packet.structured_inputs),
      files: packet.files,
    });
  }

  for (const packet of props.workItemPackets) {
    groups.push({
      key: packet.id,
      title: packet.summary ?? humanizeToken(packet.packet_kind),
      entries: readOperatorFacingEntries(packet.structured_inputs),
      files: packet.files,
    });
  }

  return groups.filter((group) => group.entries.length > 0 || group.files.length > 0);
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
  context: string | null;
} {
  if (props.scope.scopeKind !== 'workflow') {
    return {
      title:
        props.selectedWorkItem?.title ??
        props.selectedWorkItemTitle ??
        props.selectedWorkItemId ??
        'Selected work item',
      latest_status: buildWorkItemLatestStatus(
        props.selectedWorkItem,
        props.selectedWorkItemTasks,
      ),
      workflow_name: props.workflow.name,
      context: readOptionalText(props.selectedWorkItem?.goal) ?? null,
    };
  }

  return {
    title: props.workflow.name,
    latest_status:
      readOptionalText(props.stickyStrip?.summary) ??
      readOptionalText(props.workflow.pulse.summary) ??
      'Workflow is active.',
    workflow_name: null,
    context: null,
  };
}

function buildWorkItemLatestStatus(
  workItem: DashboardWorkflowWorkItemRecord | null,
  tasks: Record<string, unknown>[],
): string {
  const blockedReason =
    readOptionalText(workItem?.blocked_reason) ??
    readOptionalText(workItem?.gate_decision_feedback);
  if (blockedReason) {
    return blockedReason;
  }
  const taskHeadline = buildTaskHeadline(tasks);
  if (taskHeadline) {
    return taskHeadline;
  }
  const nextExpectedAction = readOptionalText(workItem?.next_expected_action);
  if (nextExpectedAction) {
    return nextExpectedAction;
  }
  return 'Work item details are loading.';
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

function readCompactTaskRows(tasks: Record<string, unknown>[]): Array<{
  id: string;
  title: string;
  role: string | null;
  state: string;
}> {
  return tasks
    .map((task, index) => {
      const id = readOptionalText(task.id) ?? `task-${index}`;
      const title = readOptionalText(task.title) ?? id;
      const role = humanizeOptionalToken(readOptionalText(task.role));
      const state = humanizeToken(readOptionalText(task.state) ?? 'pending');
      return {
        id,
        title,
        role,
        state,
      };
    })
    .filter((task) => task.title.trim().length > 0);
}

function readOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeOptionalToken(value: string | null): string | null {
  return value ? humanizeToken(value) : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function readBasicEntry(label: string, value: string | null): [string, string] | null {
  return value ? [label, value] : null;
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

function shouldSuppressSelectedTaskInputGroup(
  value: unknown,
  entries: Array<[string, string]>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (entries.length !== 1 || entries[0]?.[0] !== 'Requested deliverable') {
    return false;
  }

  return Object.keys(value as Record<string, unknown>).some((key) => {
    const normalizedKey = key
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
    return (
      normalizedKey === 'subject_revision'
      || normalizedKey === 'activation_id'
      || normalizedKey === 'execution_context_id'
      || normalizedKey.endsWith('_id')
      || normalizedKey.endsWith('_ids')
    );
  });
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
