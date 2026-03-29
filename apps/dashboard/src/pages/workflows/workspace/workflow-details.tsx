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
  const normalizedScope = normalizeDetailsScope(props.scope, props.selectedWorkItem, props.selectedWorkItemTitle);
  const selectedWorkItemId = props.selectedWorkItem?.id ?? props.selectedWorkItemId ?? null;
  const isWorkflowScope = normalizedScope.scopeKind === 'workflow';
  const isWorkItemScope = !isWorkflowScope;
  const workflowPackets = isWorkflowScope
    ? props.inputPackets.filter((packet) => packet.work_item_id === null)
    : [];
  const latestTaskContext = isWorkItemScope
    ? readOperatorFacingTaskInput(props.selectedTask?.input)
    : null;
  const hasLatestTaskContext = isWorkItemScope && hasStructuredContent(latestTaskContext);
  const shouldShowParentWorkItemInputs = isWorkItemScope && Boolean(selectedWorkItemId);
  const compactTaskRows = isWorkItemScope ? readCompactTaskRows(props.selectedWorkItemTasks) : [];
  const workItemPackets =
    shouldShowParentWorkItemInputs && selectedWorkItemId
      ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
      : [];
  const scope = buildDetailsScope({ ...props, scope: normalizedScope });
  const hasLaunchInputs = isWorkflowScope && hasStructuredContent(props.workflowParameters);
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

      {hasLatestTaskContext || hasLaunchInputs || workflowPackets.length > 0 || workItemPackets.length > 0 ? (
        <div className="grid gap-3">
          {hasLatestTaskContext ? (
            <StructuredBlock label="Current context" value={latestTaskContext} />
          ) : null}
          {hasLaunchInputs ? (
            <StructuredBlock label="Launch inputs" value={props.workflowParameters} />
          ) : null}
          {workflowPackets.length > 0 ? <PacketSection packets={workflowPackets} /> : null}
          {workItemPackets.length > 0 ? <PacketSection packets={workItemPackets} /> : null}
        </div>
      ) : null}

      {isWorkItemScope && hasTaskDetails ? (
        <div className="grid gap-2 border-t border-border/60 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Tasks
            </p>
            <p className="text-sm text-muted-foreground">
              {buildTaskHeadline(props.selectedWorkItemTasks) ?? `${compactTaskRows.length} ${pluralize('task', compactTaskRows.length)}`}
            </p>
          </div>
          <CompactTaskList tasks={compactTaskRows} />
        </div>
      ) : null}
    </section>
  );
}

function PacketSection(props: { packets: DashboardWorkflowInputPacketRecord[] }): JSX.Element {
  return (
    <div className="grid gap-3">
      {props.packets.map((packet) => (
        <div key={packet.id} className="grid gap-1.5 border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
          <strong className="text-sm text-foreground">
            {packet.summary ?? humanizeToken(packet.packet_kind)}
          </strong>
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
    <div className="grid gap-1.5">
      {props.label ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {props.label}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <dl className="divide-y divide-border/60">
          {entries.map(([label, value]) => (
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

function CompactTaskList(props: {
  tasks: Array<{
    id: string;
    title: string;
    state: string;
  }>;
}): JSX.Element {
  if (props.tasks.length === 0) {
    return <></>;
  }

  return (
    <ul className="grid divide-y divide-border/60">
      {props.tasks.map((task) => (
        <li
          key={task.id}
          className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{task.title}</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{task.state}</span>
        </li>
      ))}
    </ul>
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
        props.selectedTask,
      ),
      workflow_name: props.workflow.name,
      context:
        readOptionalText(props.selectedTask?.description) ??
        readOptionalText(props.selectedWorkItem?.goal) ??
        null,
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

function buildTaskLatestStatus(task: DashboardTaskRecord | null): string | null {
  if (!task) {
    return null;
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
  latestTask: DashboardTaskRecord | null,
): string {
  const blockedReason =
    readOptionalText(workItem?.blocked_reason) ??
    readOptionalText(workItem?.gate_decision_feedback);
  if (blockedReason) {
    return blockedReason;
  }
  const latestTaskStatus = buildTaskLatestStatus(latestTask);
  if (latestTaskStatus) {
    return latestTaskStatus;
  }
  return buildTaskHeadline(tasks) ?? 'Work item details are loading.';
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

function readCompactTaskRows(tasks: Record<string, unknown>[]): Array<{
  id: string;
  title: string;
  state: string;
}> {
  return tasks
    .map((task, index) => {
      const id = readOptionalText(task.id) ?? `task-${index}`;
      const title = readOptionalText(task.title) ?? id;
      const state = humanizeToken(readOptionalText(task.state) ?? 'pending');
      return {
        id,
        title,
        state,
      };
    })
    .filter((task) => task.title.trim().length > 0);
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
    if (shouldSuppressOpaqueOperatorFacingValue(key, normalizedValue)) {
      continue;
    }
    filtered[key] = normalizedValue;
  }
  return filtered;
}

function shouldRenderOperatorFacingTaskInputKey(key: string): boolean {
  const normalized = normalizeOperatorFacingTaskInputKey(key);
  if (normalized.length === 0) {
    return false;
  }
  if (
    normalized === 'slug' ||
    normalized === 'slugs' ||
    normalized.endsWith('_slug') ||
    normalized.endsWith('_slugs')
  ) {
    return false;
  }
  if (
    normalized === 'subject_revision' ||
    normalized === 'activation_id' ||
    normalized === 'execution_context_id'
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
    const trimmed = sanitizeOperatorFacingString(value);
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => normalizeOperatorFacingTaskInputValue(entry))
      .filter((entry) => entry !== null);
    return items.length > 0 ? items : null;
  }
  if (value && typeof value === 'object') {
    const filtered = filterOperatorFacingInputRecord(value as Record<string, unknown>);
    return Object.keys(filtered).length > 0 ? filtered : null;
  }
  return null;
}

function shouldSuppressOpaqueOperatorFacingValue(key: string, value: unknown): boolean {
  const normalizedKey = normalizeOperatorFacingTaskInputKey(key);
  if (!looksLikeInternalReferenceLabel(normalizedKey)) {
    return false;
  }
  if (typeof value === 'string') {
    return looksLikeOpaqueReferenceValue(value);
  }
  if (Array.isArray(value)) {
    return (
      value.length > 0 &&
      value.every((entry) => typeof entry === 'string' && looksLikeOpaqueReferenceValue(entry))
    );
  }
  return false;
}

function looksLikeInternalReferenceLabel(value: string): boolean {
  return (
    value === 'artifact' ||
    value === 'artifacts' ||
    value === 'subject' ||
    value === 'subjects' ||
    value === 'task' ||
    value === 'tasks' ||
    value === 'workflow' ||
    value === 'work_item' ||
    value === 'work item' ||
    value === 'activation' ||
    value === 'execution_context'
  );
}

function normalizeOperatorFacingTaskInputKey(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

function sanitizeOperatorFacingString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  return stripCredentialedUrl(trimmed);
}

function stripCredentialedUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.username && !parsed.password) {
      return value;
    }
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return value;
  }
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
  if (value && typeof value === 'object') {
    const entries = readStructuredEntries(value);
    if (entries.length === 0) {
      return null;
    }
    return entries.map(([label, text]) => `${label}: ${text}`).join(' • ');
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

function looksLikeOpaqueIdentifier(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function looksLikeOpaqueReferenceValue(value: string): boolean {
  return looksLikeOpaqueIdentifier(value)
    || /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(value);
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
