import type { ReactNode } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import type {
  DashboardMissionControlWorkflowCard,
  DashboardTaskRecord,
  DashboardWorkflowBoardResponse,
  DashboardWorkflowInputPacketFileRecord,
  DashboardWorkflowInputPacketRecord,
  DashboardWorkflowStickyStrip,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';

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
}): JSX.Element {
  const selectedWorkItemId = props.selectedWorkItem?.id ?? props.selectedWorkItemId ?? null;
  const workflowPackets = props.inputPackets.filter((packet) => packet.work_item_id === null);
  const workItemPackets = selectedWorkItemId
    ? props.inputPackets.filter((packet) => packet.work_item_id === selectedWorkItemId)
    : [];
  const scope = buildDetailsScope(props);
  const hasTaskInput = hasStructuredContent(props.selectedTask?.input);
  const hasInputs =
    workflowPackets.length > 0
    || workItemPackets.length > 0
    || hasTaskInput
    || hasStructuredContent(props.workflowParameters);

  return (
    <section className="grid gap-4">
      <header className="grid gap-3 border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{scope.scope_label}</Badge>
            {scope.badges.map((badge) => (
              <Badge key={`${scope.scope_label}:${badge}`} variant="secondary">
                {badge}
              </Badge>
            ))}
          </div>

          <div className="grid gap-1">
            <h3 className="text-base font-semibold text-foreground">{scope.title}</h3>
            {scope.summary ? <p className="text-sm text-muted-foreground">{scope.summary}</p> : null}
          </div>

          {scope.callout ? (
            <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
              {scope.callout}
            </p>
          ) : null}

          {scope.rows.length > 0 ? (
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {scope.rows.map(([label, value]) => (
                <div key={label} className="grid gap-0.5">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="text-sm text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
      </header>

      {hasInputs ? (
        <DetailSection title="Inputs">
          {hasStructuredContent(props.workflowParameters) ? (
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

      {scope.related_tasks.length > 0 ? (
        <DetailSection title="Related tasks">
          <div className="grid gap-2">
            {scope.related_tasks.map((task) => (
              <div
                key={task.id}
                className={
                  task.is_selected
                    ? 'flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-100/90 px-3 py-2 text-sm dark:border-amber-500/60 dark:bg-amber-500/10'
                    : 'flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm'
                }
              >
                <span className="font-medium text-foreground">{task.title}</span>
                {task.role ? <Badge variant="outline">{humanizeToken(task.role)}</Badge> : null}
                {task.state ? <Badge variant="secondary">{humanizeToken(task.state)}</Badge> : null}
              </div>
            ))}
          </div>
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
      <p className="text-sm font-semibold text-foreground">{props.title}</p>
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
          <article key={packet.id} className="grid gap-2 rounded-lg border border-border/70 bg-muted/5 px-3 py-2">
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
          </article>
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
}): {
  scope_label: string;
  title: string;
  summary: string | null;
  badges: string[];
  callout: string | null;
  rows: Array<[string, string]>;
  related_tasks: Array<{ id: string; title: string; role: string | null; state: string | null; is_selected: boolean }>;
} {
  if (props.selectedTask || props.selectedTaskId) {
    return {
      scope_label: 'Task',
      title:
        props.selectedTask?.title
        ?? props.selectedTaskTitle
        ?? props.selectedTaskId
        ?? 'Selected task',
      summary: readOptionalText(props.selectedTask?.description),
      badges: [
        props.selectedTask?.role ? humanizeToken(props.selectedTask.role) : null,
        humanizeToken(props.selectedTask?.state ?? ''),
      ].filter((value): value is string => Boolean(value)),
      callout: null,
      rows: compactRows([
        [
          'Work item',
          props.selectedTask?.work_item_title
          ?? props.selectedWorkItemTitle
          ?? props.selectedTask?.work_item_id
          ?? props.selectedWorkItemId,
        ],
        ['Stage', props.selectedTask?.stage_name ? humanizeToken(props.selectedTask.stage_name) : null],
      ]),
      related_tasks: buildRelatedTasks(
        props.selectedWorkItemTasks,
        props.selectedTask?.id ?? props.selectedTaskId,
      ),
    };
  }

  if (props.selectedWorkItem || props.selectedWorkItemId) {
    return {
      scope_label: 'Work item',
      title:
        props.selectedWorkItem?.title
        ?? props.selectedWorkItemTitle
        ?? props.selectedWorkItemId
        ?? 'Selected work item',
      summary:
        readOptionalText(props.selectedWorkItem?.acceptance_criteria) ??
        readOptionalText(props.selectedWorkItem?.goal) ??
        readOptionalText(props.selectedWorkItem?.notes),
      badges: [
        props.selectedWorkItem?.stage_name ? humanizeToken(props.selectedWorkItem.stage_name) : null,
        readColumnLabel(props.board, props.selectedWorkItem?.column_id),
        shouldShowPriorityBadge(props.selectedWorkItem?.priority)
          ? humanizeToken(props.selectedWorkItem?.priority ?? '')
          : null,
      ].filter((value): value is string => Boolean(value)),
      callout:
        readOptionalText(props.selectedWorkItem?.blocked_reason) ??
        readOptionalText(props.selectedWorkItem?.gate_decision_feedback),
      rows: compactRows([
        ['Workflow', props.workflow.name],
        ['Stage', props.selectedWorkItem?.stage_name ? humanizeToken(props.selectedWorkItem.stage_name) : null],
        ['Lane', readColumnLabel(props.board, props.selectedWorkItem?.column_id)],
      ]),
      related_tasks: buildRelatedTasks(props.selectedWorkItemTasks, null),
    };
  }

  return {
    scope_label: 'Workflow',
    title: props.workflow.name,
    summary: readOptionalText(props.stickyStrip?.summary) ?? readOptionalText(props.workflow.pulse.summary),
    badges: [
      props.workflow.lifecycle ? humanizeToken(props.workflow.lifecycle) : null,
      props.workflow.posture ? humanizeToken(props.workflow.posture) : null,
    ].filter((value): value is string => Boolean(value)),
    callout: null,
    rows: compactRows([
      ['Playbook', props.workflow.playbookName],
      ['Workspace', props.workflow.workspaceName],
    ]),
    related_tasks: [],
  };
}

function buildRelatedTasks(
  tasks: Record<string, unknown>[],
  selectedTaskId: string | null,
): Array<{ id: string; title: string; role: string | null; state: string | null; is_selected: boolean }> {
  return tasks.map((task) => ({
    id: typeof task.id === 'string' ? task.id : 'unknown-task',
    title: typeof task.title === 'string' ? task.title : 'Untitled task',
    role: typeof task.role === 'string' ? task.role : null,
    state: typeof task.state === 'string' ? task.state : null,
    is_selected: typeof task.id === 'string' && task.id === selectedTaskId,
  }));
}

function compactRows(rows: Array<[string, string | null | undefined]>): Array<[string, string]> {
  const compacted: Array<[string, string]> = [];
  for (const [label, value] of rows) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    compacted.push([label, trimmed]);
  }
  return compacted;
}

function readColumnLabel(board: DashboardWorkflowBoardResponse | null, columnId: string | null | undefined): string | null {
  if (!columnId) {
    return null;
  }
  const column = board?.columns.find((entry) => entry.id === columnId);
  return column?.label ?? humanizeToken(columnId);
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

function shouldShowPriorityBadge(priority: string | null | undefined): boolean {
  if (!priority) {
    return false;
  }
  const normalized = priority.trim().toLowerCase();
  return normalized !== 'medium' && normalized !== 'normal';
}
