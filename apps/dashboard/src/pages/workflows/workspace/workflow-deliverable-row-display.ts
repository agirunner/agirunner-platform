import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
  DashboardWorkflowOperatorBriefRecord,
} from '../../../lib/api.js';
import type { DeliverableBrowserRow } from './workflow-deliverable-browser-support.js';
import {
  isInPlaceArtifactPreviewTarget,
  readDeliverableTargetDisplayLabel,
  resolveDeliverableTargetAction,
  sanitizeDeliverableTarget,
} from './workflow-deliverables.support.js';

export interface DeliverableTableRowRecord {
  deliverable: DashboardWorkflowDeliverableRecord;
  primaryRow: DeliverableBrowserRow;
  relatedRows: DeliverableBrowserRow[];
  sourceBrief?: DashboardWorkflowOperatorBriefRecord | null;
}

export interface DeliverableMetadataEntry {
  label: string;
  value: string;
}

export function readDeliverableRowSpecialist(row: DeliverableTableRowRecord): string | null {
  const preview = asRecord(row.deliverable.content_preview);
  return (
    readText(preview.source_role_name) ??
    readText(row.sourceBrief?.source_role_name) ??
    readProducedByLine(
      readText(preview.summary),
      readText(preview.text),
      readText(preview.snippet),
      readText(preview.markdown),
    )
  );
}

export function readDeliverableRowLabel(row: DeliverableTableRowRecord): string | null {
  const trimmed = readText(row.primaryRow.label);
  if (!trimmed) {
    return null;
  }
  return trimmed === row.deliverable.title ? null : trimmed;
}

export function readDeliverableRowRecordedAt(row: DeliverableTableRowRecord): string | null {
  return readText(row.primaryRow.createdAt) ?? readText(row.sourceBrief?.created_at);
}

export function readDeliverableRowMetadata(
  row: DeliverableTableRowRecord,
): DeliverableMetadataEntry[] {
  const entries: DeliverableMetadataEntry[] = [];
  appendTargetMetadata(entries, row.primaryRow);
  for (const relatedRow of row.relatedRows) {
    appendRelatedTargetMetadata(entries, relatedRow);
  }
  return entries;
}

export function readDeliverableRowOpenHref(row: DeliverableTableRowRecord): string | null {
  if (row.primaryRow.rowKind !== 'reference') {
    return null;
  }
  const action = resolveDeliverableTargetAction(sanitizeDeliverableTarget(row.primaryRow.target));
  return action.action_kind === 'external_link' && typeof action.href === 'string'
    ? action.href
    : null;
}

function appendTargetMetadata(
  entries: DeliverableMetadataEntry[],
  row: DeliverableBrowserRow,
): void {
  if (row.rowKind === 'inline') {
    return;
  }

  const target = sanitizeDeliverableTarget(row.target);
  pushMetadata(entries, 'Path', readVisibleDeliverablePath(target));
  pushMetadata(entries, 'Repository', target.repo_ref);
  pushMetadata(entries, 'URL', readVisibleDeliverableUrl(target));
}

function appendRelatedTargetMetadata(
  entries: DeliverableMetadataEntry[],
  row: DeliverableBrowserRow,
): void {
  if (row.rowKind === 'inline') {
    return;
  }

  const target = sanitizeDeliverableTarget(row.target);
  if (row.rowKind === 'artifact') {
    pushMetadata(
      entries,
      'Related File',
      readDeliverableTargetDisplayLabel(target, row.label),
    );
    return;
  }

  pushMetadata(
    entries,
    'Related Target',
    readVisibleDeliverableUrl(target)
      ?? readDeliverableTargetDisplayLabel(target, row.label),
  );
}

function readVisibleDeliverablePath(
  target: DashboardWorkflowDeliverableTarget,
): string | null {
  const path = readText(target.path);
  if (!path || path.startsWith('artifact:')) {
    return null;
  }
  return path;
}

function readVisibleDeliverableUrl(
  target: DashboardWorkflowDeliverableTarget,
): string | null {
  const resolvedUrl = resolveDeliverableTargetUrl(target);
  if (!resolvedUrl || isInPlaceArtifactPreviewTarget(resolvedUrl)) {
    return null;
  }
  return resolvedUrl;
}

function resolveDeliverableTargetUrl(target: DashboardWorkflowDeliverableTarget): string | null {
  const action = resolveDeliverableTargetAction(target);
  if (action.action_kind === 'external_link' && typeof action.href === 'string') {
    return action.href;
  }
  return readText(target.url);
}

function pushMetadata(
  entries: DeliverableMetadataEntry[],
  label: string,
  value: string | null | undefined,
): void {
  const trimmed = readText(value);
  if (!trimmed || entries.some((entry) => entry.value === trimmed)) {
    return;
  }
  entries.push({ label, value: trimmed });
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readProducedByLine(...values: Array<string | null>): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    const matchedLine = value.match(/(?:^|\n)\s*Produced by:\s*(.+?)\s*(?:\n|$)/i);
    if (matchedLine?.[1]) {
      return readText(matchedLine[1]);
    }
  }
  return null;
}
