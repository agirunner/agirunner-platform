import { Badge } from '../../../components/ui/badge.js';
import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverablesPacket,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import { WorkflowDeliverableBrowser } from './workflow-deliverable-browser.js';
import { normalizeDeliverablesPacket } from './workflow-deliverables.support.js';

export function WorkflowDeliverables(props: {
  packet: DashboardWorkflowDeliverablesPacket;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  scope: WorkflowWorkbenchScopeDescriptor;
  onLoadMore(): void;
}): JSX.Element {
  const packet = normalizeDeliverablesPacket(props.packet);
  const normalizedScope = props.scope;
  const selectedWorkItemId = props.selectedWorkItemId;
  const scopedDeliverables = buildScopedDeliverables(
    packet,
    normalizedScope.scopeKind,
    selectedWorkItemId,
  );

  return (
    <div className="flex min-h-full flex-1 flex-col gap-4 pb-1 pr-1">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Deliverables</p>
          <Badge variant="outline">
            {normalizedScope.scopeKind === 'workflow' ? 'Workflow' : 'Work item'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {buildDeliverablesScopeDescription(normalizedScope.scopeKind, props.selectedWorkItemTitle)}
        </p>
      </div>

      {scopedDeliverables.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {buildEmptyMessage(normalizedScope.scopeKind, props.selectedWorkItemTitle)}
        </p>
      ) : (
        <div className="grid gap-3">
          {scopedDeliverables.map((deliverable) => (
            <DeliverableRow
              key={deliverable.descriptor_id}
              deliverable={deliverable}
              showScopeBadge={normalizedScope.scopeKind === 'workflow'}
            />
          ))}
        </div>
      )}

      {packet.next_cursor ? (
        <div className="flex justify-start sm:justify-end">
          <button
            type="button"
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            onClick={props.onLoadMore}
          >
            Load older deliverables
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DeliverableRow(props: {
  deliverable: DashboardWorkflowDeliverableRecord;
  showScopeBadge: boolean;
}): JSX.Element {
  const stageLabel = props.deliverable.delivery_stage === 'final' ? 'Final' : 'Interim';
  const createdLabel = formatEntryTimestamp(props.deliverable.created_at);

  return (
    <article className="grid gap-4 rounded-2xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-foreground">{props.deliverable.title}</strong>
            <Badge variant="secondary">{stageLabel}</Badge>
            <Badge variant="outline">{humanizeToken(props.deliverable.descriptor_kind)}</Badge>
            {props.showScopeBadge ? (
              <Badge variant="outline">
                {props.deliverable.work_item_id ? 'Work item' : 'Workflow'}
              </Badge>
            ) : null}
          </div>
          {createdLabel ? (
            <p className="text-xs text-muted-foreground">Created {createdLabel}</p>
          ) : null}
        </div>
      </div>

      {props.deliverable.summary_brief ? (
        <p className="text-sm text-muted-foreground">{props.deliverable.summary_brief}</p>
      ) : null}

      <WorkflowDeliverableBrowser deliverable={props.deliverable} />
    </article>
  );
}

function buildScopedDeliverables(
  packet: DashboardWorkflowDeliverablesPacket,
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemId: string | null,
): DashboardWorkflowDeliverableRecord[] {
  const sortByStageAndTime = (deliverables: DashboardWorkflowDeliverableRecord[]) =>
    [...deliverables].sort(compareDeliverables);

  if (scopeKind === 'workflow') {
    return dedupeDeliverablesByIdentity(sortByStageAndTime([
      ...packet.final_deliverables,
      ...packet.in_progress_deliverables,
    ]));
  }

  const matchesSelectedWorkItem = (deliverable: DashboardWorkflowDeliverableRecord): boolean =>
    selectedWorkItemId !== null && deliverable.work_item_id === selectedWorkItemId;

  return dedupeDeliverablesByIdentity(sortByStageAndTime(
    [...packet.final_deliverables, ...packet.in_progress_deliverables].filter(matchesSelectedWorkItem),
  ));
}

function dedupeDeliverablesByIdentity(
  deliverables: DashboardWorkflowDeliverableRecord[],
): DashboardWorkflowDeliverableRecord[] {
  const selectedByIdentity = new Map<string, DashboardWorkflowDeliverableRecord>();

  for (const deliverable of deliverables) {
    const identityKey = readDeliverableIdentityKey(deliverable);
    const existing = selectedByIdentity.get(identityKey);
    if (!existing || compareDeliverablePreference(deliverable, existing) < 0) {
      selectedByIdentity.set(identityKey, deliverable);
    }
  }

  return [...selectedByIdentity.values()].sort(compareDeliverables);
}

function compareDeliverables(
  left: DashboardWorkflowDeliverableRecord,
  right: DashboardWorkflowDeliverableRecord,
): number {
  return (
    readStageWeight(left) - readStageWeight(right) ||
    readDeliverableTimestamp(right) - readDeliverableTimestamp(left) ||
    compareDeliverablePreference(left, right)
  );
}

function compareDeliverablePreference(
  left: DashboardWorkflowDeliverableRecord,
  right: DashboardWorkflowDeliverableRecord,
): number {
  return (
    readDeliverableRichnessRank(left) - readDeliverableRichnessRank(right) ||
    right.descriptor_id.localeCompare(left.descriptor_id)
  );
}

function readStageWeight(deliverable: DashboardWorkflowDeliverableRecord): number {
  return deliverable.delivery_stage === 'final' ? 0 : 1;
}

function readDeliverableTimestamp(deliverable: DashboardWorkflowDeliverableRecord): number {
  return readTimestamp(deliverable.updated_at ?? deliverable.created_at);
}

function readDeliverableRichnessRank(deliverable: DashboardWorkflowDeliverableRecord): number {
  let score = 0;
  if (deliverable.descriptor_kind === 'deliverable_packet') {
    score += 16;
  }
  if (deliverable.summary_brief) {
    score += 8;
  }
  if (deliverable.source_brief_id) {
    score += 4;
  }
  if (Object.keys(deliverable.content_preview ?? {}).length > 0) {
    score += 2;
  }
  if (deliverable.primary_target.artifact_id) {
    score += 1;
  }
  return -score;
}

function readDeliverableIdentityKey(deliverable: DashboardWorkflowDeliverableRecord): string {
  const scopeKey = deliverable.work_item_id ?? 'workflow';
  const target = deliverable.primary_target;
  if (target.artifact_id) {
    return `${scopeKey}:artifact:${target.artifact_id}`;
  }
  if (target.url) {
    return `${scopeKey}:url:${target.url}`;
  }
  if (target.path) {
    return `${scopeKey}:path:${target.path}`;
  }
  return `${scopeKey}:descriptor:${deliverable.descriptor_id}`;
}

function readTimestamp(value: string): number {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function buildDeliverablesScopeDescription(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemTitle: string | null,
): string {
  if (scopeKind === 'workflow') {
    return 'Showing all deliverables recorded across this workflow, with Final entries first and newest entries at the top.';
  }

  const workItemTitle = readText(selectedWorkItemTitle);
  return workItemTitle
    ? `Showing only deliverables recorded for ${workItemTitle}.`
    : 'Showing only deliverables recorded for the selected work item.';
}

function buildEmptyMessage(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemTitle: string | null,
): string {
  if (scopeKind === 'workflow') {
    return 'No deliverables are recorded for this workflow yet.';
  }

  const workItemTitle = readText(selectedWorkItemTitle);
  return workItemTitle
    ? `No deliverables are recorded for ${workItemTitle} yet.`
    : 'No deliverables are recorded for this work item yet.';
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatEntryTimestamp(value: string): string | null {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis).toLocaleString();
}
