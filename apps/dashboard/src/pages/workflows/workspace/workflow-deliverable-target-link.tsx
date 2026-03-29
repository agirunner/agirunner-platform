import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';
import {
  readDeliverableTargetDisplayLabel,
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
      <p className="text-sm font-medium text-foreground">{targetLabel}</p>
      {action.action_kind === 'inline_reference' ? (
        <p className="text-xs text-muted-foreground">Already visible in this workflow workspace.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Canonical target</p>
      )}
      {readTargetLocations(target, action.href).map((location) => (
        <p
          key={location}
          className="break-all rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground"
        >
          {location}
        </p>
      ))}
    </div>
  );
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function readTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  return readDeliverableTargetDisplayLabel(target, 'Deliverable target');
}

function buildTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  const label = readTargetLabel(target);
  return target.target_kind.length > 0
    ? `${label} (${humanizeToken(target.target_kind)})`
    : label;
}

function readTargetLocations(
  target: DashboardWorkflowDeliverableTarget,
  href: string | undefined,
): string[] {
  const locations = [target.path, target.repo_ref, href]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return Array.from(new Set(locations));
}
