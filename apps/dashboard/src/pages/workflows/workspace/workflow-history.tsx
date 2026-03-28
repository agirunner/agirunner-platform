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
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">Briefs</p>
        <p className="text-sm text-muted-foreground">
          Published briefs and durable updates for this {scopeSubject}.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.selectedTaskId ? (
          <Badge variant="outline">Scoped to selected task</Badge>
        ) : props.selectedWorkItemId ? (
          <Badge variant="outline">Scoped to selected work item</Badge>
        ) : null}
      </div>

      {props.packet.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
          No briefs published for this {scopeSubject} yet.
        </div>
      ) : (
        <div className="grid gap-4">
          {props.packet.groups.map((group) => (
            <section key={group.group_id} className="grid gap-3">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {group.label}
                </p>
                <div className="h-px flex-1 bg-border/70" />
              </div>
              <div className="grid gap-3">
                {group.item_ids
                  .map((itemId) => props.packet.items.find((entry) => entry.item_id === itemId))
                  .filter((item): item is NonNullable<typeof item> => Boolean(item))
                  .map((item) => (
                    <HistoryItemCard
                      key={item.item_id}
                      workflowId={props.workflowId}
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
  workflowId: string;
  item: DashboardWorkflowHistoryPacket['items'][number];
}): JSX.Element {
  const sourceLabel = formatWorkflowActivitySourceLabel(
    props.item.source_label,
    props.item.source_kind,
  );
  const summary = props.item.summary.trim();
  const headline = props.item.headline.trim();
  const showSummary = summary.length > 0 && summary !== headline;

  return (
    <article className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{humanizeToken(props.item.item_kind)}</Badge>
        <Badge variant="secondary">{sourceLabel}</Badge>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTimestamp(props.item.created_at)}
        </span>
      </div>
      <strong className="text-foreground">{props.item.headline}</strong>
      {showSummary ? (
        <details className="rounded-xl border border-border/70 bg-muted/10 p-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Open brief</summary>
          <p className="mt-3 text-sm text-muted-foreground">{props.item.summary}</p>
        </details>
      ) : null}
    </article>
  );
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
