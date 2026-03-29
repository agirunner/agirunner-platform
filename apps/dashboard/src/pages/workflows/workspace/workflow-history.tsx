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
            <section key={group.group_id} className="grid gap-3">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {group.label}
                </p>
                <div className="h-px flex-1 bg-border/70" />
              </div>
              <div className="grid gap-3">
                {group.items.map((item) => (
                  <HistoryItemCard
                    key={item.item_id}
                    item={item}
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
}): JSX.Element {
  const sourceLabel = formatWorkflowActivitySourceLabel(
    props.item.source_label,
    props.item.source_kind,
  );
  const summary = props.item.summary.trim();
  const headline = props.item.headline.trim();
  const displayHeadline = headline || summary;
  const showSummary = summary.length > 0 && summary !== displayHeadline;

  return (
    <article className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
      <p className="text-xs font-medium text-muted-foreground">
        {sourceLabel}
        {' · '}
        {formatRelativeTimestamp(props.item.created_at)}
      </p>
      <strong className="text-foreground">{displayHeadline}</strong>
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
