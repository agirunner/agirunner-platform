import { useId, useState } from 'react';

import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
} from '../../../lib/api.js';
import {
  hasMeaningfulDeliverableTarget,
  isDownloadableDeliverableTarget,
  resolveDeliverableTargetAction,
  sanitizeDeliverableTarget,
  sanitizeDeliverableTargets,
} from './workflow-deliverables.support.js';
import { WorkflowDeliverableTargetLink } from './workflow-deliverable-target-link.js';

interface ResolvedTarget {
  key: string;
  href: string;
  target: DashboardWorkflowDeliverableTarget;
}

export function WorkflowDeliverableBrowser(props: {
  deliverable: DashboardWorkflowDeliverableRecord;
}): JSX.Element | null {
  const artifactTargets = readArtifactTargets(props.deliverable);
  const externalTargets = readExternalTargets(props.deliverable);
  const browserId = useId();
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(
    artifactTargets[0]?.key ?? null,
  );
  const selectedTarget = artifactTargets.find((target) => target.key === selectedTargetKey) ?? artifactTargets[0] ?? null;

  if (!selectedTarget && externalTargets.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4">
      {artifactTargets.length > 0 ? (
        <section className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <p className="text-sm font-semibold text-foreground">
                Produced artifacts ({artifactTargets.length})
              </p>
              <p className="text-xs text-muted-foreground">
                Preview and download artifacts directly from this deliverable.
              </p>
            </div>
            {selectedTarget ? (
              <a
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                href={selectedTarget.href}
                download
              >
                Download artifact
              </a>
            ) : null}
          </div>
          {artifactTargets.length > 1 ? (
            <div
              className="flex max-w-full gap-2 overflow-x-auto pb-1"
              role="tablist"
              aria-label="Deliverable artifacts"
            >
              {artifactTargets.map((target) => (
                <button
                  key={target.key}
                  type="button"
                  role="tab"
                  aria-selected={selectedTarget?.key === target.key}
                  className={
                    selectedTarget?.key === target.key
                      ? 'rounded-full border border-accent/60 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent'
                      : 'rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-muted-foreground'
                  }
                  onClick={() => setSelectedTargetKey(target.key)}
                >
                  {readTargetLabel(target.target)}
                </button>
              ))}
            </div>
          ) : null}
          {selectedTarget ? (
            <div className="grid gap-2">
              <div className="rounded-xl border border-border/70 bg-background shadow-sm">
                <iframe
                  key={selectedTarget.key}
                  title={`${props.deliverable.title} preview`}
                  src={selectedTarget.href}
                  className="h-96 w-full rounded-xl bg-white"
                />
              </div>
              <div id={browserId} className="text-xs text-muted-foreground">
                {selectedTarget.target.path ?? selectedTarget.target.repo_ref ?? selectedTarget.href}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {externalTargets.length > 0 ? (
        <section className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
          <div className="grid gap-1">
            <p className="text-sm font-semibold text-foreground">Canonical deliverable targets</p>
            <p className="text-xs text-muted-foreground">
              Non-artifact outputs stay visible here without navigating away from Workflows.
            </p>
          </div>
          <div className="grid gap-3">
            {externalTargets.map((target) => (
              <WorkflowDeliverableTargetLink key={target.key} target={target.target} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function readArtifactTargets(
  deliverable: DashboardWorkflowDeliverableRecord,
): ResolvedTarget[] {
  return readResolvedTargets(deliverable).filter((target) =>
    isDownloadableDeliverableTarget(target.target),
  );
}

function readExternalTargets(
  deliverable: DashboardWorkflowDeliverableRecord,
): ResolvedTarget[] {
  return readResolvedTargets(deliverable).filter((target) =>
    !isDownloadableDeliverableTarget(target.target),
  );
}

function readResolvedTargets(
  deliverable: DashboardWorkflowDeliverableRecord,
): ResolvedTarget[] {
  const targets = [
    sanitizeDeliverableTarget(deliverable.primary_target),
    ...sanitizeDeliverableTargets(deliverable.secondary_targets),
  ];
  const seen = new Set<string>();
  const resolvedTargets: ResolvedTarget[] = [];

  for (const target of targets) {
    if (!hasMeaningfulDeliverableTarget(target)) {
      continue;
    }
    const action = resolveDeliverableTargetAction(target);
    if (action.action_kind !== 'external_link' || !action.href) {
      continue;
    }
    const key = `${target.target_kind}:${target.artifact_id ?? action.href}:${target.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resolvedTargets.push({
      key,
      href: action.href,
      target,
    });
  }

  return resolvedTargets;
}

function readTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  const label = target.label.trim();
  return label.length > 0 ? label : 'Artifact';
}
