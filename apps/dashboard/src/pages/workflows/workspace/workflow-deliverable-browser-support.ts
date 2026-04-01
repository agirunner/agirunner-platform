import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
} from '../../../lib/api.js';
import { describeArtifactPreview } from '../../artifact-preview/artifact-preview-support.js';
import {
  formatDeliverableTargetKind,
  hasMeaningfulDeliverableTarget,
  isBrowserDeliverableTarget,
  readDeliverableTargetDisplayLabel,
  resolveDeliverableTargetHref,
  sanitizeDeliverableTarget,
  sanitizeDeliverableTargets,
} from './workflow-deliverables.support.js';

export type DeliverableBrowserRow =
  | ArtifactBrowserRow
  | InlineBrowserRow
  | ReferenceBrowserRow;

interface BaseBrowserRow {
  key: string;
  label: string;
  typeLabel: string;
  createdAt: string;
  sizeBytes: number | null;
  canView: boolean;
}

export interface ArtifactBrowserRow extends BaseBrowserRow {
  rowKind: 'artifact';
  target: DashboardWorkflowDeliverableTarget;
  downloadHref: string;
  previewHref: string;
}

interface InlineBrowserRow extends BaseBrowserRow {
  rowKind: 'inline';
  content: string;
}

interface ReferenceBrowserRow extends BaseBrowserRow {
  rowKind: 'reference';
  target: DashboardWorkflowDeliverableTarget;
}

export function buildBrowserRows(
  deliverable: DashboardWorkflowDeliverableRecord,
): DeliverableBrowserRow[] {
  const rows: DeliverableBrowserRow[] = [];
  const seenKeys = new Set<string>();

  for (const target of readResolvedTargets(deliverable)) {
    const href = resolveDeliverableTargetHref(target);
    const key = readTargetKey(target, href);
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    if (isBrowserDeliverableTarget(target) && href) {
      rows.push({
        rowKind: 'artifact',
        key,
        label: readDeliverableTargetDisplayLabel(target, 'Deliverable file'),
        typeLabel: formatDeliverableTargetKind(target.target_kind || 'artifact'),
        createdAt: deliverable.created_at,
        sizeBytes:
          typeof target.size_bytes === 'number' && Number.isFinite(target.size_bytes)
            ? target.size_bytes
            : null,
        canView: canViewArtifactTarget(target, deliverable),
        target,
        previewHref: href,
        downloadHref: resolveBrowserDownloadHref(href),
      });
      continue;
    }
    rows.push({
      rowKind: 'reference',
      key,
      label: readDeliverableTargetDisplayLabel(target, 'Deliverable reference'),
      typeLabel: formatDeliverableTargetKind(target.target_kind || 'reference'),
      createdAt: deliverable.created_at,
      sizeBytes: null,
      canView: true,
      target,
    });
  }

  const inlineContent = readInlineContent(deliverable);
  const trimmedSummary = deliverable.summary_brief?.trim() ?? null;
  if (inlineContent && (rows.length === 0 || inlineContent !== trimmedSummary)) {
    rows.push({
      rowKind: 'inline',
      key: `inline:${deliverable.descriptor_id}`,
      label: readInlineLabel(deliverable),
      typeLabel: 'Inline summary',
      createdAt: deliverable.created_at,
      sizeBytes: null,
      canView: true,
      content: inlineContent,
    });
  }

  return rows.sort(compareBrowserRows);
}

function readResolvedTargets(
  deliverable: DashboardWorkflowDeliverableRecord,
): DashboardWorkflowDeliverableTarget[] {
  return [
    sanitizeDeliverableTarget(deliverable.primary_target),
    ...sanitizeDeliverableTargets(deliverable.secondary_targets),
  ].filter(
    (target) => hasMeaningfulDeliverableTarget(target) && !shouldSuppressInlineSummaryTarget(target),
  );
}

function shouldSuppressInlineSummaryTarget(target: DashboardWorkflowDeliverableTarget): boolean {
  return target.target_kind === 'inline_summary';
}

function readInlineContent(deliverable: DashboardWorkflowDeliverableRecord): string | null {
  const preview = asRecord(deliverable.content_preview);
  return (
    readText(preview.markdown) ??
    readText(preview.text) ??
    readText(preview.summary) ??
    readText(preview.snippet) ??
    readText(deliverable.summary_brief)
  );
}

function readInlineLabel(deliverable: DashboardWorkflowDeliverableRecord): string {
  const targets = [deliverable.primary_target, ...deliverable.secondary_targets]
    .map((target) => sanitizeDeliverableTarget(target))
    .filter((target) => target.target_kind === 'inline_summary');
  return targets[0]
    ? readDeliverableTargetDisplayLabel(targets[0], 'Inline content')
    : 'Inline content';
}

function compareBrowserRows(left: DeliverableBrowserRow, right: DeliverableBrowserRow): number {
  return readRowWeight(left) - readRowWeight(right) || left.label.localeCompare(right.label);
}

function readRowWeight(row: DeliverableBrowserRow): number {
  if (row.rowKind === 'artifact') {
    return 0;
  }
  if (row.rowKind === 'inline') {
    return 1;
  }
  return 2;
}

function canViewArtifactTarget(
  target: DashboardWorkflowDeliverableTarget,
  deliverable: DashboardWorkflowDeliverableRecord,
): boolean {
  const previewKind = readPreviewKind(deliverable.preview_capabilities);
  if (previewKind === 'binary') {
    return false;
  }

  if (deliverable.primary_target.artifact_id === target.artifact_id && readCanInlinePreview(deliverable)) {
    return true;
  }

  const previewDescriptor = describeArtifactPreview('', target.path ?? target.label);
  return previewDescriptor.canPreview;
}

function readCanInlinePreview(deliverable: DashboardWorkflowDeliverableRecord): boolean {
  return deliverable.preview_capabilities.can_inline_preview === true;
}

function readPreviewKind(previewCapabilities: Record<string, unknown>): string | null {
  const value = previewCapabilities.preview_kind;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function readTargetKey(target: DashboardWorkflowDeliverableTarget, href: string | null): string {
  return [
    target.target_kind,
    target.artifact_id ?? '',
    target.path ?? '',
    target.repo_ref ?? '',
    href ?? '',
    target.label,
  ].join(':');
}

export function resolveBrowserDownloadHref(href: string): string {
  return rewriteTaskArtifactTransportPath(href, 'download') ?? href;
}

function rewriteTaskArtifactTransportPath(href: string, mode: 'download'): string | null {
  try {
    const parsed = new URL(href, 'http://dashboard.local');
    const taskArtifactMatch =
      parsed.pathname.match(
        /^\/api\/v1\/tasks\/([^/]+)\/artifacts\/([^/]+)(?:\/(preview|download|permalink))?$/,
      ) ?? parsed.pathname.match(/^\/artifacts\/tasks\/([^/]+)\/([^/?#]+)$/);
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

export function formatEntryTimestamp(value: string): string | null {
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis)) {
    return null;
  }
  return new Date(millis).toLocaleString();
}

export function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
