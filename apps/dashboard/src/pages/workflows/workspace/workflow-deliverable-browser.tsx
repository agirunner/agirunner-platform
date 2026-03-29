import { useId, useState } from 'react';

import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
} from '../../../lib/api.js';
import {
  hasMeaningfulDeliverableTarget,
  isBrowserDeliverableTarget,
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
                Produced artifacts ({artifactTargets.length})
              </p>
              <p className="text-xs text-muted-foreground">
                Preview and download artifacts directly from this deliverable.
              </p>
            </div>
            {selectedTarget ? (
              <a
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                href={selectedTarget.downloadHref}
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
                  Preview is unavailable for this artifact. Use download from this browser.
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
  const label = target.label.trim();
  if (label.length > 0 && !isGenericArtifactLabel(label)) {
    return label;
  }

  const pathLabel = readTargetPathLabel(target.path) ?? readTargetPathLabel(target.repo_ref);
  if (pathLabel) {
    return pathLabel;
  }

  return label.length > 0 ? label : 'Artifact';
}

function readArtifactIdentityKey(
  target: DashboardWorkflowDeliverableTarget,
  downloadHref: string,
): string {
  return target.artifact_id ?? target.path ?? target.repo_ref ?? downloadHref;
}

function isGenericArtifactLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized === 'artifact' ||
    normalized === 'open artifact' ||
    normalized === 'download artifact' ||
    normalized === 'preview artifact' ||
    normalized === 'preview inline' ||
    normalized === 'open' ||
    normalized === 'download'
  );
}

function readTargetPathLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/^artifact:[^/]+\//, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? trimmed;
}
