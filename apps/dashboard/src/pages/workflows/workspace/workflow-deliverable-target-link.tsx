import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';
import {
  resolveDeliverableTargetAction,
  sanitizeDeliverableTarget,
} from './workflow-deliverables.support.js';

export function WorkflowDeliverableTargetLink(props: {
  target: DashboardWorkflowDeliverableTarget;
}): JSX.Element {
  const target = sanitizeDeliverableTarget(props.target);
  const action = resolveDeliverableTargetAction(target);
  const targetLabel = buildTargetLabel(target);

  return (
    <div className="grid gap-2">
      {action.action_kind === 'inline_reference' ? (
        <>
          <p className="text-sm font-medium text-foreground">{targetLabel}</p>
          <p className="text-xs text-muted-foreground">Already visible in this workflow workspace.</p>
        </>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground">{targetLabel}</p>
          <a
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            href={action.href}
          >
            Open target
          </a>
        </div>
      )}
      {target.path || target.repo_ref ? (
        <p className="text-xs text-muted-foreground">{target.path ?? target.repo_ref}</p>
      ) : null}
    </div>
  );
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function readTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  return target.label.length > 0 ? target.label : 'Linked output';
}

function buildTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  const label = readTargetLabel(target);
  return target.target_kind.length > 0
    ? `${label} (${humanizeToken(target.target_kind)})`
    : label;
}
