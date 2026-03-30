import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowHistoryPacket } from '../../../lib/api.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';
import { formatWorkflowActivitySourceLabel } from './workflow-live-console.support.js';

export function WorkflowHistory(props: {
  workflowId: string;
  packet: DashboardWorkflowHistoryPacket;
  selectedWorkItemId?: string | null;
  selectedTaskId?: string | null;
  scopeSubject?: 'workflow' | 'work item' | 'task';
  onLoadMore(): void;
}): JSX.Element {
  const scopeSubject = props.scopeSubject ?? 'workflow';
  const displayGroups = getHistoryDisplayGroups(props.packet);
  const visibleKinds = new Set(
    displayGroups.flatMap((group) => group.items.map((item) => item.item_kind)),
  );
  const shouldShowTypeLabel = visibleKinds.size > 1;

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">Briefs</p>
        <p className="text-sm text-muted-foreground">
          Published briefs and durable updates for this {scopeSubject}.
        </p>
      </div>

      {displayGroups.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">
          No briefs published for this {scopeSubject} yet.
        </p>
      ) : (
        <div className="grid gap-4">
          {displayGroups.map((group) => (
            <section key={group.group_id} className="grid gap-2.5">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {group.label}
                </p>
                <div className="h-px flex-1 bg-border/70" />
              </div>
              <div className="overflow-hidden rounded-xl border border-border/70 bg-background/40">
                {group.items.map((item) => (
                  <HistoryItemCard
                    key={item.item_id}
                    item={item}
                    shouldShowTypeLabel={shouldShowTypeLabel}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {props.packet.next_cursor ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={props.onLoadMore}>
            Load more briefs
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function HistoryItemCard(props: {
  item: DashboardWorkflowHistoryPacket['items'][number];
  shouldShowTypeLabel: boolean;
}): JSX.Element {
  const sourceLabel = formatWorkflowActivitySourceLabel(
    props.item.source_label,
    props.item.source_kind,
  );
  const summary = props.item.summary.trim();
  const headline = props.item.headline.trim();
  const displayHeadline = headline || summary;
  const showSummary = summary.length > 0 && summary !== displayHeadline;
  const typeLabel = props.shouldShowTypeLabel
    ? formatHistoryKindLabel(props.item.item_kind)
    : null;

  return (
    <article className="grid gap-1.5 border-b border-border/60 px-3 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{sourceLabel}</span>
        {typeLabel ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] uppercase tracking-[0.14em]">
            {typeLabel}
          </Badge>
        ) : null}
        <span>{formatRelativeTimestamp(props.item.created_at)}</span>
      </div>
      <strong className="text-sm leading-6 text-foreground">{displayHeadline}</strong>
      {showSummary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
    </article>
  );
}

function getHistoryDisplayGroups(packet: DashboardWorkflowHistoryPacket): Array<
  DashboardWorkflowHistoryPacket['groups'][number] & {
    items: DashboardWorkflowHistoryPacket['items'];
  }
> {
  const itemsById = new Map(packet.items.map((item) => [item.item_id, item] as const));

  return [...packet.groups]
    .map((group) => ({
      ...group,
      items: group.item_ids
        .map((itemId) => itemsById.get(itemId))
        .filter((item): item is DashboardWorkflowHistoryPacket['items'][number] => Boolean(item))
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    }))
    .filter((group) => group.items.length > 0)
    .sort((left, right) => right.anchor_at.localeCompare(left.anchor_at));
}

function formatHistoryKindLabel(
  itemKind: DashboardWorkflowHistoryPacket['items'][number]['item_kind'],
): string {
  switch (itemKind) {
    case 'milestone_brief':
      return 'Milestone';
    case 'operator_update':
      return 'Update';
    case 'platform_notice':
      return 'Notice';
    case 'lifecycle_event':
      return 'Lifecycle';
    case 'intervention':
      return 'Intervention';
    case 'input':
      return 'Input';
    case 'deliverable':
      return 'Deliverable';
    case 'redrive':
      return 'Redrive';
  }
}
