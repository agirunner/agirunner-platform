import { Badge } from '../../../components/ui/badge.js';
import type {
  DashboardWorkflowOperatorBriefRecord,
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverablesPacket,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import { WorkflowBriefRenderer } from './workflow-brief-renderer.js';
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
  const scopedWorkingHandoffs = buildScopedWorkingHandoffs(
    packet.working_handoffs,
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

      {scopedWorkingHandoffs.length > 0 ? (
        <WorkingHandoffsSection handoffs={scopedWorkingHandoffs} />
      ) : null}

      <DeliverableStageSection
        title="Final"
        deliverables={scopedDeliverables.finalDeliverables}
        emptyMessage={buildEmptyStageMessage('final', normalizedScope.scopeKind, props.selectedWorkItemTitle)}
        showScopeBadge={normalizedScope.scopeKind === 'workflow'}
      />

      <DeliverableStageSection
        title="Interim"
        deliverables={scopedDeliverables.inProgressDeliverables}
        emptyMessage={buildEmptyStageMessage('interim', normalizedScope.scopeKind, props.selectedWorkItemTitle)}
        showScopeBadge={normalizedScope.scopeKind === 'workflow'}
      />

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

function WorkingHandoffsSection(props: {
  handoffs: DashboardWorkflowOperatorBriefRecord[];
}): JSX.Element {
  return (
    <section className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">Working handoffs</p>
        <Badge variant="outline">{props.handoffs.length}</Badge>
      </div>
      <div className="grid gap-3">
        {props.handoffs.map((handoff) => (
          <article
            key={handoff.id}
            className="grid gap-3 rounded-2xl border border-border/70 bg-muted/10 p-4"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">In progress</Badge>
              {handoff.source_role_name ? (
                <Badge variant="outline">{handoff.source_role_name}</Badge>
              ) : null}
              <span>Updated {formatEntryTimestamp(handoff.updated_at || handoff.created_at)}</span>
            </div>
            <WorkflowBriefRenderer brief={handoff} compact />
          </article>
        ))}
      </div>
    </section>
  );
}

function DeliverableStageSection(props: {
  title: 'Final' | 'Interim';
  deliverables: DashboardWorkflowDeliverableRecord[];
  emptyMessage: string;
  showScopeBadge: boolean;
}): JSX.Element {
  return (
    <section className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-foreground">{props.title}</p>
        <Badge variant="outline">{props.deliverables.length}</Badge>
      </div>
      {props.deliverables.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.emptyMessage}</p>
      ) : (
        props.deliverables.map((deliverable) => (
          <DeliverableRow
            key={deliverable.descriptor_id}
            deliverable={deliverable}
            showScopeBadge={props.showScopeBadge}
            stageLabel={props.title}
          />
        ))
      )}
    </section>
  );
}

function DeliverableRow(props: {
  deliverable: DashboardWorkflowDeliverableRecord;
  showScopeBadge: boolean;
  stageLabel: 'Final' | 'Interim';
}): JSX.Element {
  return (
    <article className="grid gap-4 rounded-2xl border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-foreground">{props.deliverable.title}</strong>
            <Badge variant="secondary">{props.stageLabel}</Badge>
            <Badge variant="outline">{humanizeToken(props.deliverable.descriptor_kind)}</Badge>
            {props.showScopeBadge ? (
              <Badge variant="outline">
                {props.deliverable.work_item_id ? 'Work item' : 'Workflow'}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Created {formatEntryTimestamp(props.deliverable.created_at)}
          </p>
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
): {
  finalDeliverables: DashboardWorkflowDeliverableRecord[];
  inProgressDeliverables: DashboardWorkflowDeliverableRecord[];
} {
  if (scopeKind === 'workflow') {
    return {
      finalDeliverables: sortDeliverables(packet.final_deliverables),
      inProgressDeliverables: sortDeliverables(packet.in_progress_deliverables),
    };
  }

  const matchesSelectedWorkItem = (deliverable: DashboardWorkflowDeliverableRecord): boolean =>
    selectedWorkItemId !== null && deliverable.work_item_id === selectedWorkItemId;

  return {
    finalDeliverables: sortDeliverables(packet.final_deliverables.filter(matchesSelectedWorkItem)),
    inProgressDeliverables: sortDeliverables(
      packet.in_progress_deliverables.filter(matchesSelectedWorkItem),
    ),
  };
}

function buildScopedWorkingHandoffs(
  handoffs: DashboardWorkflowOperatorBriefRecord[],
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemId: string | null,
): DashboardWorkflowOperatorBriefRecord[] {
  if (scopeKind === 'workflow') {
    return sortWorkingHandoffs(handoffs);
  }

  if (selectedWorkItemId === null) {
    return [];
  }

  return sortWorkingHandoffs(
    handoffs.filter((handoff) => handoff.work_item_id === selectedWorkItemId),
  );
}

function sortDeliverables(
  deliverables: DashboardWorkflowDeliverableRecord[],
): DashboardWorkflowDeliverableRecord[] {
  return [...deliverables].sort((left, right) => readDeliverableTimestamp(right) - readDeliverableTimestamp(left));
}

function sortWorkingHandoffs(
  handoffs: DashboardWorkflowOperatorBriefRecord[],
): DashboardWorkflowOperatorBriefRecord[] {
  return [...handoffs].sort(
    (left, right) => readTimestamp(right.updated_at ?? right.created_at) - readTimestamp(left.updated_at ?? left.created_at),
  );
}

function readDeliverableTimestamp(deliverable: DashboardWorkflowDeliverableRecord): number {
  return readTimestamp(deliverable.updated_at ?? deliverable.created_at);
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

function buildEmptyStageMessage(
  stage: 'final' | 'interim',
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemTitle: string | null,
): string {
  const stageLabel = stage === 'final' ? 'final' : 'interim';
  if (scopeKind === 'workflow') {
    return `No ${stageLabel} deliverables are recorded for this workflow yet.`;
  }

  const workItemTitle = readText(selectedWorkItemTitle);
  return workItemTitle
    ? `No ${stageLabel} deliverables are recorded for ${workItemTitle} yet.`
    : `No ${stageLabel} deliverables are recorded for this work item yet.`;
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

function formatEntryTimestamp(value: string): string {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return 'Unknown time';
  }
  return new Date(millis).toLocaleString();
}
