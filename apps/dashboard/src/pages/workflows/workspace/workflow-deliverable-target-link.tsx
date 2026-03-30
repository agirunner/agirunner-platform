import type { DashboardWorkflowDeliverableTarget } from '../../../lib/api.js';
import {
  formatDeliverableTargetKind,
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
  const metadata = readTargetMetadata(target, action.href);

  return (
    <div className="grid gap-2">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">{targetLabel}</p>
        <p className="text-xs text-muted-foreground">
          {formatDeliverableTargetKind(target.target_kind)}
        </p>
      </div>
      {action.action_kind === 'external_link' ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">Canonical target</p>
          {action.href ? (
            <a
              className="inline-flex w-fit items-center rounded-md border border-border/70 bg-background/80 px-3 py-1.5 text-xs font-medium text-accent underline-offset-4 hover:underline"
              href={action.href}
            >
              Open target
            </a>
          ) : null}
        </div>
      ) : null}
      {metadata.length > 0 ? (
        <dl className="grid gap-2">
          {metadata.map((entry) => (
            <div key={`${entry.label}:${entry.value}`} className="grid gap-1">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {entry.label}
              </dt>
              <dd className="break-all rounded-lg border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function readTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  return readDeliverableTargetDisplayLabel(target, 'Deliverable target');
}

function buildTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  return readTargetLabel(target);
}

function readTargetMetadata(
  target: DashboardWorkflowDeliverableTarget,
  href: string | undefined,
): Array<{ label: string; value: string }> {
  const entries: Array<{ label: string; value: string }> = [];
  pushMetadata(entries, 'Path', target.path);
  pushMetadata(entries, 'Repository ref', target.repo_ref);
  pushMetadata(entries, 'URL', href);
  return entries;
}

function pushMetadata(
  entries: Array<{ label: string; value: string }>,
  label: string,
  value: string | null | undefined,
): void {
  if (typeof value !== 'string') {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || entries.some((entry) => entry.value === trimmed)) {
    return;
  }
  entries.push({ label, value: trimmed });
}
