import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
} from '../../../lib/api.js';
import type { DeliverableBrowserRow } from './workflow-deliverable-browser-support.js';
import {
  resolveDeliverableTargetAction,
  sanitizeDeliverableTarget,
} from './workflow-deliverables.support.js';

export interface DeliverableTableRowRecord {
  deliverable: DashboardWorkflowDeliverableRecord;
  browserRow: DeliverableBrowserRow;
}

export interface DeliverableMetadataEntry {
  label: string;
  value: string;
}

export function readDeliverableRowLabel(row: DeliverableTableRowRecord): string | null {
  const trimmed = readText(row.browserRow.label);
  if (!trimmed) {
    return null;
  }
  return trimmed === row.deliverable.title ? null : trimmed;
}

export function readDeliverableRowMetadata(
  row: DeliverableTableRowRecord,
): DeliverableMetadataEntry[] {
  if (row.browserRow.rowKind === 'inline') {
    return [];
  }

  const target = sanitizeDeliverableTarget(row.browserRow.target);
  const entries: DeliverableMetadataEntry[] = [];
  pushMetadata(entries, 'Path', target.path);
  pushMetadata(entries, 'Repository', target.repo_ref);
  pushMetadata(entries, 'URL', resolveDeliverableTargetUrl(target));
  return entries;
}

export function readDeliverableRowOpenHref(row: DeliverableTableRowRecord): string | null {
  if (row.browserRow.rowKind !== 'reference') {
    return null;
  }
  const action = resolveDeliverableTargetAction(sanitizeDeliverableTarget(row.browserRow.target));
  return action.action_kind === 'external_link' && typeof action.href === 'string'
    ? action.href
    : null;
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
