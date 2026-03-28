import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowHistoryPacket } from '../../../lib/api.js';
import { buildWorkflowDetailPermalink } from '../../workflow-detail/workflow-detail-permalinks.js';
import { formatRelativeTimestamp } from '../../workflow-detail/workflow-detail-presentation.js';

export function WorkflowHistory(props: {
  workflowId: string;
  packet: DashboardWorkflowHistoryPacket;
  onLoadMore(): void;
}): JSX.Element {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-semibold text-foreground">History</p>
        <p className="text-sm text-muted-foreground">
          Detailed milestone briefs, interventions, inputs, deliverables, and redrive lineage ordered newest first.
        </p>
      </div>

      {props.packet.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
          No historical workflow packets have been published yet.
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

      {props.packet.items.length > 0 ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={props.onLoadMore}>
            Load older history
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
  const linkedWorkItemId = props.item.linked_target_ids.find((id) => id !== props.workflowId) ?? null;

  return (
    <article className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{humanizeToken(props.item.item_kind)}</Badge>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTimestamp(props.item.created_at)}
        </span>
      </div>
      <div className="grid gap-1">
        <strong className="text-foreground">{props.item.headline}</strong>
        <p className="text-sm text-muted-foreground">{props.item.summary}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          to={
            linkedWorkItemId
              ? buildWorkflowDetailPermalink(props.workflowId, { workItemId: linkedWorkItemId })
              : buildWorkflowDetailPermalink(props.workflowId, {})
          }
        >
          Open workflow context
        </Link>
      </div>
    </article>
  );
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
