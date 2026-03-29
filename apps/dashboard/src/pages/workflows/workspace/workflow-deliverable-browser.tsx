import { useId, useState } from 'react';

import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
} from '../../../lib/api.js';
import {
  hasMeaningfulDeliverableTarget,
  isBrowserDeliverableTarget,
  readDeliverableTargetDisplayLabel,
  resolveDeliverableTargetHref,
  sanitizeDeliverableTarget,
  sanitizeDeliverableTargets,
} from './workflow-deliverables.support.js';
import { WorkflowDeliverableTargetLink } from './workflow-deliverable-target-link.js';

interface ResolvedTarget {
  key: string;
  target: DashboardWorkflowDeliverableTarget;
}

interface ResolvedArtifactTarget extends ResolvedTarget {
  previewHref: string | null;
  downloadHref: string;
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
  const selectedTarget =
    artifactTargets.find((target) => target.key === selectedTargetKey) ??
    artifactTargets[0] ??
    null;

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
                Files in this deliverable ({artifactTargets.length})
              </p>
              <p className="text-xs text-muted-foreground">
                Preview supported files here and download the selected file without leaving
                Workflows.
              </p>
            </div>
            {selectedTarget ? (
              <a
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                href={selectedTarget.downloadHref}
                download
              >
                Download file
              </a>
            ) : null}
          </div>
          {artifactTargets.length > 1 ? (
            <div
              className="flex max-w-full gap-2 overflow-x-auto pb-1"
              role="tablist"
              aria-label="Deliverable files"
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
              {selectedTarget.previewHref ? (
                <div className="rounded-xl border border-border/70 bg-background shadow-sm">
                  <iframe
                    key={selectedTarget.key}
                    title={`${props.deliverable.title} preview`}
                    src={selectedTarget.previewHref}
                    className="h-96 w-full rounded-xl bg-white"
                  />
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border/70 bg-background/80 px-3 py-6 text-sm text-muted-foreground">
                  Preview is unavailable for this file. Download it from Deliverables.
                </p>
              )}
              <div id={browserId} className="text-xs text-muted-foreground">
                {selectedTarget.target.path ??
                  selectedTarget.target.repo_ref ??
                  selectedTarget.previewHref ??
                  selectedTarget.downloadHref}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {externalTargets.length > 0 ? (
        <section className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-3">
          <div className="grid gap-1">
            <p className="text-sm font-semibold text-foreground">Other deliverable targets</p>
            <p className="text-xs text-muted-foreground">
              Repository outputs and other reference targets stay visible here without leaving
              Workflows.
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
): ResolvedArtifactTarget[] {
  const seenArtifactKeys = new Set<string>();

  return readResolvedTargets(deliverable)
    .filter((target) => isBrowserDeliverableTarget(target.target))
    .flatMap((target) => {
      const href = resolveDeliverableTargetHref(target.target);
      if (!href) {
        return [];
      }
      const downloadHref = resolveArtifactDownloadHref(href);
      const artifactKey = readArtifactIdentityKey(target.target, downloadHref);
      if (seenArtifactKeys.has(artifactKey)) {
        return [];
      }
      seenArtifactKeys.add(artifactKey);
      return [
        {
          ...target,
          previewHref: resolveArtifactPreviewHref(href),
          downloadHref,
        },
      ];
    });
}

function readExternalTargets(deliverable: DashboardWorkflowDeliverableRecord): ResolvedTarget[] {
  return readResolvedTargets(deliverable).filter(
    (target) => !isBrowserDeliverableTarget(target.target),
  );
}

function readResolvedTargets(deliverable: DashboardWorkflowDeliverableRecord): ResolvedTarget[] {
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
    const key = [
      target.target_kind,
      target.artifact_id ?? '',
      target.url,
      target.path ?? '',
      target.repo_ref ?? '',
      target.label,
    ].join(':');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    resolvedTargets.push({
      key,
      target,
    });
  }

  return resolvedTargets;
}

function resolveArtifactPreviewHref(href: string): string | null {
  return rewriteArtifactTransportPath(href, 'preview');
}

function resolveArtifactDownloadHref(href: string): string {
  return rewriteArtifactTransportPath(href, 'download') ?? href;
}

function rewriteArtifactTransportPath(href: string, mode: 'preview' | 'download'): string | null {
  try {
    const parsed = new URL(href, 'http://dashboard.local');
    const taskArtifactMatch = parsed.pathname.match(
      /^\/api\/v1\/tasks\/([^/]+)\/artifacts\/([^/]+)(?:\/(preview|download|permalink))?$/,
    );
    if (!taskArtifactMatch) {
      return null;
    }
    const [, taskId, artifactId] = taskArtifactMatch;
    parsed.pathname = `/api/v1/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}/${mode}`;
    return serializeHref(parsed);
  } catch {
    return null;
  }
}

function serializeHref(parsed: URL): string {
  return parsed.origin === 'http://dashboard.local'
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString();
}

function readTargetLabel(target: DashboardWorkflowDeliverableTarget): string {
  return readDeliverableTargetDisplayLabel(target, 'File');
}

function readArtifactIdentityKey(
  target: DashboardWorkflowDeliverableTarget,
  downloadHref: string,
): string {
  return target.artifact_id ?? target.path ?? target.repo_ref ?? downloadHref;
}
