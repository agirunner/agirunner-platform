import type {
  LogEntry,
  LogOperationRecord,
  LogStatsResponse,
} from '../../lib/api.js';
import type { InspectorFilters } from '../../components/execution-inspector-support.js';
import {
  describeExecutionHeadline,
  describeExecutionNextAction,
  describeExecutionOperationLabel,
  describeExecutionSummary,
  formatCost,
  formatDuration,
  formatNumber,
  readExecutionSignals,
  shortId,
  summarizeLogContext,
} from '../../components/execution-inspector-support.js';
import { formatLogRelativeTime } from '../../components/log-viewer/log-time.js';

export interface InspectorOverviewCard {
  title: string;
  value: string;
  detail: string;
}

export interface RecentLogActivityPacket {
  id: number;
  actorLabel: string;
  emphasisLabel: string;
  emphasisTone: 'secondary' | 'warning' | 'destructive' | 'success';
  narrativeHeadline: string;
  summary: string;
  whyItMatters: string;
  outcomeLabel: string | null;
  nextAction: string;
  scopeSummary: string | null;
  facts: RecentLogActivityFact[];
  context: string[];
  signals: string[];
  supportingContext: string[];
  createdAtLabel: string;
  createdAtIso: string;
  createdAtDetail: string;
  actions: RecentLogActivityAction[];
}

export interface RecentLogActivityAction {
  href: string;
  label: string;
}

export interface RecentLogActivityFact {
  label: string;
  value: string;
}

export function buildInspectorOverviewCards(
  filters: InspectorFilters,
  scopedWorkflowId: string,
  stats?: LogStatsResponse,
  operations: LogOperationRecord[] = [],
): InspectorOverviewCard[] {
  const totals = stats?.data.totals;

  return [
    {
      title: 'Focus',
      value: describeInspectorFocus(filters, scopedWorkflowId),
      detail: `${describeTimeWindow(filters.timeWindowHours)} window • ${describeLevelScope(filters.level)}`,
    },
    {
      title: 'Attention',
      value: describeAttentionValue(totals?.error_count ?? 0),
      detail: describeAttentionDetail(totals?.count ?? 0, totals?.error_count ?? 0, operations),
    },
    {
      title: 'Spend signal',
      value: formatCost(sumCost(stats)),
      detail: `${formatDuration(totals?.total_duration_ms ?? 0)} recorded runtime`,
    },
  ];
}

export function buildRecentLogActivityPackets(
  entries: LogEntry[],
  limit = 3,
  now = Date.now(),
): RecentLogActivityPacket[] {
  return entries.slice(0, limit).map((entry) => {
    const actorLabel = describeLogActorLabel(entry);
    const emphasisTone = describeLogEmphasisTone(entry);
    const workflowContextHref = buildLogWorkflowContextLink(entry);
    const taskRecordHref = entry.task_id ? `/work/tasks/${entry.task_id}` : null;
    const outcomeLabel = describeLogOutcomeLabel(entry);
    const nextAction = describeExecutionNextAction(entry);
    const scopeSummary = buildLogScopeSummary(entry);
    const context = summarizeLogContext(entry);
    const signals = readExecutionSignals(entry);
    return {
      id: entry.id,
      actorLabel,
      emphasisLabel: describeLogEmphasisLabel(entry),
      emphasisTone,
      narrativeHeadline: buildLogNarrativeHeadline(entry, actorLabel),
      summary: describeExecutionSummary(entry),
      whyItMatters: describeLogWhyItMatters(entry),
      outcomeLabel,
      nextAction,
      scopeSummary,
      facts: buildRecentLogActivityFacts({
        outcomeLabel,
        nextAction,
        scopeSummary,
      }),
      context,
      signals,
      supportingContext: dedupeActivityContext([...signals, ...context]),
      createdAtLabel: formatRecentActivityAge(entry.created_at, now),
      createdAtIso: entry.created_at,
      createdAtDetail: new Date(entry.created_at).toLocaleString(),
      actions: buildRecentLogActivityActions({
        taskRecordHref,
        workflowContextHref,
      }),
    };
  });
}

function buildRecentLogActivityActions(input: {
  taskRecordHref: string | null;
  workflowContextHref: string | null;
}): RecentLogActivityAction[] {
  const actions: RecentLogActivityAction[] = [];
  if (input.workflowContextHref) {
    actions.push({ href: input.workflowContextHref, label: 'Board context' });
  }
  if (input.taskRecordHref) {
    actions.push({
      href: input.taskRecordHref,
      label: input.workflowContextHref ? 'Step diagnostics' : 'Step record',
    });
  }
  return actions;
}

export function buildLogWorkflowContextLink(
  entry: Pick<
    LogEntry,
    'workflow_id' | 'work_item_id' | 'activation_id' | 'stage_name'
  >,
): string | null {
  if (!entry.workflow_id) {
    return null;
  }

  const next = new URLSearchParams();
  if (entry.work_item_id) {
    next.set('work_item', entry.work_item_id);
  }
  if (entry.activation_id) {
    next.set('activation', entry.activation_id);
  }
  if (entry.stage_name && !entry.work_item_id && !entry.activation_id) {
    next.set('stage', entry.stage_name);
  }
  const query = next.toString();
  return query
    ? `/work/boards/${entry.workflow_id}?${query}`
    : `/work/boards/${entry.workflow_id}`;
}

function describeInspectorFocus(filters: InspectorFilters, scopedWorkflowId: string): string {
  if (filters.taskId) {
    return `Step ${shortId(filters.taskId)}`;
  }
  if (filters.workItemId) {
    return `Work item ${shortId(filters.workItemId)}`;
  }
  if (filters.activationId) {
    return `Activation ${shortId(filters.activationId)}`;
  }
  if (filters.stageName) {
    return `Stage ${filters.stageName}`;
  }
  if (filters.workflowId) {
    return `Board ${shortId(filters.workflowId)}`;
  }
  if (scopedWorkflowId) {
    return `Board ${shortId(scopedWorkflowId)}`;
  }
  return 'All execution';
}

function buildLogNarrativeHeadline(entry: LogEntry, actorLabel: string): string {
  const target =
    entry.task_title ??
    entry.workflow_name ??
    entry.resource_name ??
    (entry.task_id ? `step ${shortId(entry.task_id)}` : null) ??
    (entry.workflow_id ? `board ${shortId(entry.workflow_id)}` : null);
  const operation = describeExecutionOperationLabel(entry.operation).toLowerCase();

  if (entry.error?.message || entry.status === 'failed') {
    return target
      ? `${actorLabel} hit a failure while driving ${target}`
      : `${actorLabel} hit a failure during ${operation}`;
  }
  if (entry.status === 'started') {
    return target
      ? `${actorLabel} started ${target}`
      : `${actorLabel} started ${operation}`;
  }
  if (entry.status === 'completed') {
    return target
      ? `${actorLabel} completed ${target}`
      : `${actorLabel} completed ${operation}`;
  }
  if (entry.status === 'skipped') {
    return target
      ? `${actorLabel} skipped ${target}`
      : `${actorLabel} skipped ${operation}`;
  }
  return target
    ? `${actorLabel} recorded activity on ${target}`
    : `${actorLabel} recorded ${operation}`;
}

function buildLogScopeSummary(entry: LogEntry): string | null {
  const parts = [
    entry.workflow_name ?? (entry.workflow_id ? `Board ${shortId(entry.workflow_id)}` : null),
    entry.stage_name ? `Stage ${entry.stage_name}` : null,
    entry.work_item_id ? `Work item ${shortId(entry.work_item_id)}` : null,
    entry.activation_id ? `Activation ${shortId(entry.activation_id)}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' • ') : null;
}

function describeLogActorLabel(entry: LogEntry): string {
  if (entry.actor_name && entry.actor_name.trim().length > 0) {
    return entry.actor_name.trim();
  }
  if (entry.is_orchestrator_task) {
    return 'Orchestrator';
  }
  if (entry.role && entry.role.trim().length > 0) {
    return `${humanizeRole(entry.role)} specialist`;
  }
  return humanizeActorToken(entry.actor_type);
}

function describeLogEmphasisLabel(entry: LogEntry): string {
  if (entry.error?.message || entry.status === 'failed') {
    return 'Needs recovery';
  }
  if (entry.level === 'warn') {
    return 'Needs review';
  }
  if (entry.status === 'completed') {
    return 'Completed';
  }
  if (entry.status === 'started') {
    return 'In progress';
  }
  if (entry.status === 'skipped') {
    return 'Skipped';
  }
  return 'Recorded';
}

function describeLogEmphasisTone(
  entry: LogEntry,
): RecentLogActivityPacket['emphasisTone'] {
  if (entry.error?.message || entry.status === 'failed') {
    return 'destructive';
  }
  if (entry.level === 'warn' || entry.status === 'skipped') {
    return 'warning';
  }
  if (entry.status === 'completed') {
    return 'success';
  }
  return 'secondary';
}

function describeLogOutcomeLabel(entry: LogEntry): string | null {
  if (entry.error?.message) {
    return entry.error.message;
  }
  if (entry.status === 'completed') {
    return 'Execution completed without runtime errors.';
  }
  if (entry.status === 'started') {
    return 'Execution is still in flight.';
  }
  if (entry.status === 'skipped') {
    return 'Execution was skipped for this scope.';
  }
  return null;
}

function describeLogWhyItMatters(entry: LogEntry): string {
  if (entry.error?.message || entry.status === 'failed') {
    return 'This is the clearest recovery signal in the recent stream. Start here before scanning lower-severity activity.';
  }
  if (entry.level === 'warn' || entry.status === 'skipped') {
    return 'This packet carries review pressure that can turn into gate or board drag if it sits unresolved.';
  }
  if (entry.status === 'started') {
    return 'This packet marks an active execution slice, which makes it the fastest way to explain current in-flight work.';
  }
  if (entry.status === 'completed') {
    return 'This packet closes a visible execution step and gives you the cleanest handoff into board or step diagnostics.';
  }
  return 'This packet is the newest scoped execution signal available for operator review.';
}

function buildRecentLogActivityFacts(input: {
  outcomeLabel: string | null;
  nextAction: string;
  scopeSummary: string | null;
}): RecentLogActivityFact[] {
  return [
    {
      label: 'Outcome',
      value: input.outcomeLabel ?? 'Awaiting more runtime detail.',
    },
    {
      label: 'Scope',
      value: input.scopeSummary ?? 'No board or activation scope is attached.',
    },
    {
      label: 'Next step',
      value: input.nextAction,
    },
  ];
}

function dedupeActivityContext(entries: string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    values.push(entry);
  }
  return values;
}

function humanizeActorToken(value: string): string {
  if (value === 'agent') {
    return 'Agent';
  }
  if (value === 'operator') {
    return 'Operator';
  }
  if (value === 'system') {
    return 'System';
  }
  return value
    .split(/[_:\-.]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function humanizeRole(value: string): string {
  return value
    .split(/[_:\-.]/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeTimeWindow(timeWindowHours: string): string {
  const hours = Number(timeWindowHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return 'Recent';
  }
  if (hours < 24) {
    return `${formatNumber(hours)}h`;
  }
  const days = hours / 24;
  return Number.isInteger(days) ? `${formatNumber(days)}d` : `${formatNumber(hours)}h`;
}

function describeLevelScope(level: string): string {
  switch (level) {
    case 'debug':
      return 'all records';
    case 'warn':
      return 'warnings and errors';
    case 'error':
      return 'errors only';
    case 'info':
    default:
      return 'info and above';
  }
}

function describeAttentionValue(errorCount: number): string {
  if (errorCount > 0) {
    return `${formatNumber(errorCount)} errors`;
  }
  return 'Healthy slice';
}

function describeAttentionDetail(
  totalCount: number,
  errorCount: number,
  operations: LogOperationRecord[],
): string {
  if (errorCount > 0) {
    const ratio = totalCount > 0 ? Math.round((errorCount / totalCount) * 100) : 0;
    return `${ratio}% of ${formatNumber(totalCount)} entries need review`;
  }

  const topOperation = [...operations].sort((left, right) => right.count - left.count)[0];
  if (!topOperation) {
    return 'No failing records in the current slice';
  }
  return `${describeExecutionOperationLabel(topOperation.operation)} leads with ${formatNumber(topOperation.count)} entries`;
}

function sumCost(stats?: LogStatsResponse): number {
  return (stats?.data.groups ?? []).reduce(
    (sum, group) => sum + Number(group.agg.total_cost_usd ?? 0),
    0,
  );
}

function formatRecentActivityAge(createdAt: string, now: number): string {
  return formatLogRelativeTime(createdAt, now);
}
