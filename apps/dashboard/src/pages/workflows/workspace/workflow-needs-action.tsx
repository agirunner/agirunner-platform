import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type { DashboardWorkflowNeedsActionPacket } from '../../../lib/api.js';

export function WorkflowNeedsAction(props: {
  packet: DashboardWorkflowNeedsActionPacket;
  onOpenAddWork(): void;
  onOpenRedrive(): void;
  onOpenSteering(): void;
}): JSX.Element {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Needs Action</p>
          <p className="text-sm text-muted-foreground">
            Prioritized workflow actions that currently require an operator response.
          </p>
        </div>
      </div>

      {props.packet.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
          Nothing in this workflow requires operator action right now.
        </div>
      ) : (
        <div className="grid gap-3">
          {props.packet.items.map((item) => (
            <article
              key={item.action_id}
              className="grid gap-3 rounded-2xl border border-border/70 bg-background/80 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-foreground">{item.label}</strong>
                <Badge variant="warning">{humanizeToken(item.target.target_kind)}</Badge>
                <Badge variant="secondary">{humanizePriority(item.priority)} priority</Badge>
                {item.requires_confirmation ? <Badge variant="outline">Confirm</Badge> : null}
              </div>
              <div className="grid gap-1">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Why it needs action
                </p>
                <p className="text-sm text-muted-foreground">{item.summary}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  actionKind={item.action_kind}
                  onOpenAddWork={props.onOpenAddWork}
                  onOpenRedrive={props.onOpenRedrive}
                  onOpenSteering={props.onOpenSteering}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionButton(props: {
  actionKind: string;
  onOpenAddWork(): void;
  onOpenRedrive(): void;
  onOpenSteering(): void;
}): JSX.Element {
  switch (props.actionKind) {
    case 'add_work_item':
      return (
        <Button type="button" size="sm" onClick={props.onOpenAddWork}>
          Add / Modify Work
        </Button>
      );
    case 'redrive_workflow':
      return (
        <Button type="button" size="sm" onClick={props.onOpenRedrive}>
          Redrive Workflow
        </Button>
      );
    default:
      return (
        <Button type="button" size="sm" variant="outline" onClick={props.onOpenSteering}>
          Open Steering
        </Button>
      );
  }
}

function humanizeToken(value: string | null | undefined): string {
  if (!value) {
    return 'Workflow';
  }
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function humanizePriority(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'high':
      return 'High';
    case 'low':
      return 'Low';
    default:
      return 'Medium';
  }
}
