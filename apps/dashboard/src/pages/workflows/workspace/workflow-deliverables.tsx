import { useState } from 'react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowDeliverableTarget,
  DashboardWorkflowDeliverablesPacket,
} from '../../../lib/api.js';
import type { WorkflowWorkbenchScopeDescriptor } from '../workflows-page.support.js';
import {
  buildBrowserRows,
  formatEntryTimestamp,
  type DeliverableBrowserRow,
} from './workflow-deliverable-browser-support.js';
import {
  readDeliverableRowLabel,
  readDeliverableRowMetadata,
  readDeliverableRowOpenHref,
  type DeliverableMetadataEntry,
  type DeliverableTableRowRecord,
} from './workflow-deliverable-row-display.js';
import {
  normalizeDeliverablesPacket,
  sanitizeDeliverableTarget,
} from './workflow-deliverables.support.js';
import {
  WorkflowDeliverableDownloadButton,
  WorkflowDeliverablePreview,
} from './workflow-deliverable-preview.js';

interface DeliverableTableRow extends DeliverableTableRowRecord {
  key: string;
}

export function WorkflowDeliverables(props: {
  packet: DashboardWorkflowDeliverablesPacket;
  selectedWorkItemId: string | null;
  selectedWorkItemTitle: string | null;
  scope: WorkflowWorkbenchScopeDescriptor;
  onLoadMore(): void;
}): JSX.Element {
  const packet = normalizeDeliverablesPacket(props.packet);
  const scopedDeliverables = buildScopedDeliverables(
    packet,
    props.scope.scopeKind,
    props.selectedWorkItemId,
  );
  const tableRows = buildDeliverableTableRows(scopedDeliverables);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col gap-4 pb-1 pr-1">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Deliverables</p>
          <Badge variant="outline">
            {props.scope.scopeKind === 'workflow' ? 'Workflow' : 'Work item'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {buildDeliverablesScopeDescription(props.scope.scopeKind, props.selectedWorkItemTitle)}
        </p>
      </div>

      {tableRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {buildEmptyMessage(props.scope.scopeKind, props.selectedWorkItemTitle)}
        </p>
      ) : (
        <div
          data-workflows-deliverables-scroll-region="true"
          className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/70 bg-background/70"
        >
          <table className="w-full min-w-[1120px] border-collapse text-sm">
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
              <col className="w-[28%]" />
              <col className="w-[10%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Deliverable</th>
                <th className="px-3 py-2 text-left font-medium">Stage</th>
                <th className="px-3 py-2 text-left font-medium">Kind</th>
                <th className="px-3 py-2 text-left font-medium">Scope</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">Recorded</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => {
                const isSelected = row.key === selectedRowKey;
                return (
                  <DeliverableTableEntry
                    key={row.key}
                    row={row}
                    isSelected={isSelected}
                    scopeKind={props.scope.scopeKind}
                    onToggle={() =>
                      setSelectedRowKey((current) => (current === row.key ? null : row.key))
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {packet.next_cursor ? (
        <div className="flex justify-start sm:justify-end">
          <button
            type="button"
            className="text-sm font-medium text-accent underline-offset-4 hover:underline"
            onClick={props.onLoadMore}
          >
            Load older deliverables
          </button>
        </div>
      ) : null}
    </div>
  );
}

function DeliverableTableEntry(props: {
  row: DeliverableTableRow;
  isSelected: boolean;
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'];
  onToggle(): void;
}): JSX.Element {
  const { deliverable, browserRow } = props.row;
  const stageLabel = deliverable.delivery_stage === 'final' ? 'Final' : 'Interim';
  const createdLabel = formatEntryTimestamp(browserRow.createdAt) ?? '—';
  const scopeLabel =
    props.scopeKind === 'workflow'
      ? deliverable.work_item_id
        ? 'Work item'
        : 'Workflow'
      : 'Work item';
  const rowLabel = readDeliverableRowLabel(props.row);
  const metadata = readDeliverableRowMetadata(props.row);
  const openHref = readDeliverableRowOpenHref(props.row);
  const canPreview = browserRow.rowKind !== 'reference' && browserRow.canView;

  return (
    <>
      <tr className={`border-t border-border/60 ${props.isSelected ? 'bg-accent/5' : ''}`}>
        <td className="px-3 py-3 align-top">
          <div className="grid gap-1">
            <p className="font-medium text-foreground">{deliverable.title}</p>
            {rowLabel ? <p className="text-xs text-foreground/80">{rowLabel}</p> : null}
            {deliverable.summary_brief ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {deliverable.summary_brief}
              </p>
            ) : null}
          </div>
        </td>
        <td className="px-3 py-3 align-top">
          <Badge variant="secondary">{stageLabel}</Badge>
        </td>
        <td className="px-3 py-3 align-top text-muted-foreground">{browserRow.typeLabel}</td>
        <td className="px-3 py-3 align-top text-muted-foreground">{scopeLabel}</td>
        <td className="px-3 py-3 align-top">
          <DeliverableMetadataList entries={metadata} />
        </td>
        <td className="px-3 py-3 align-top text-muted-foreground">{createdLabel}</td>
        <td className="px-3 py-3 align-top">
          <div className="flex justify-end gap-2">
            {browserRow.rowKind === 'artifact' ? (
              <WorkflowDeliverableDownloadButton
                row={browserRow}
                deliverableTitle={deliverable.title}
              />
            ) : null}
            {canPreview ? (
              <Button
                type="button"
                variant={props.isSelected ? 'secondary' : 'ghost'}
                size="sm"
                aria-expanded={props.isSelected}
                onClick={props.onToggle}
              >
                {props.isSelected ? 'Hide' : 'View'}
              </Button>
            ) : null}
            {openHref ? (
              <Button variant="outline" size="sm" asChild>
                <a href={openHref}>Open</a>
              </Button>
            ) : null}
            {browserRow.rowKind !== 'artifact' && !canPreview && !openHref ? (
              <span className="text-muted-foreground">—</span>
            ) : null}
          </div>
        </td>
      </tr>

      {props.isSelected && canPreview ? (
        <tr className="border-t border-border/40 bg-muted/10">
          <td colSpan={7} className="px-4 py-4">
            <div className="rounded-xl border border-border/70 bg-background/80 p-4">
              <WorkflowDeliverablePreview row={browserRow} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function buildScopedDeliverables(
  packet: DashboardWorkflowDeliverablesPacket,
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemId: string | null,
): DashboardWorkflowDeliverableRecord[] {
  const sortByStageAndTime = (deliverables: DashboardWorkflowDeliverableRecord[]) =>
    [...deliverables].sort(compareDeliverables);

  if (scopeKind === 'workflow') {
    return dedupeDeliverablesByIdentity(
      sortByStageAndTime([...packet.final_deliverables, ...packet.in_progress_deliverables]),
    );
  }

  const matchesSelectedWorkItem = (deliverable: DashboardWorkflowDeliverableRecord): boolean =>
    selectedWorkItemId !== null && deliverable.work_item_id === selectedWorkItemId;

  return dedupeDeliverablesByIdentity(
    sortByStageAndTime(
      [...packet.final_deliverables, ...packet.in_progress_deliverables].filter(
        matchesSelectedWorkItem,
      ),
    ),
  );
}

function buildDeliverableTableRows(
  deliverables: DashboardWorkflowDeliverableRecord[],
): DeliverableTableRow[] {
  const rows: DeliverableTableRow[] = [];

  for (const deliverable of deliverables) {
    const browserRows = buildBrowserRows(deliverable);
    if (browserRows.length === 0) {
      rows.push({
        key: `${deliverable.descriptor_id}:record`,
        deliverable,
        browserRow: buildFallbackBrowserRow(deliverable),
      });
      continue;
    }
    for (const browserRow of browserRows) {
      rows.push({
        key: `${deliverable.descriptor_id}:${browserRow.key}`,
        deliverable,
        browserRow,
      });
    }
  }

  return rows;
}

function buildFallbackBrowserRow(
  deliverable: DashboardWorkflowDeliverableRecord,
): DeliverableBrowserRow {
  return {
    rowKind: 'reference',
    key: `record:${deliverable.descriptor_id}`,
    label: deliverable.title,
    typeLabel: humanizeToken(deliverable.descriptor_kind || 'deliverable_record'),
    createdAt: deliverable.created_at,
    sizeBytes: null,
    canView: false,
    target: buildFallbackTarget(deliverable),
  };
}

function buildFallbackTarget(
  deliverable: DashboardWorkflowDeliverableRecord,
): DashboardWorkflowDeliverableTarget {
  const target = sanitizeDeliverableTarget(deliverable.primary_target);
  if (target.label.length > 0) {
    return target;
  }
  return {
    ...target,
    label: deliverable.title,
  };
}

function DeliverableMetadataList(props: {
  entries: DeliverableMetadataEntry[];
}): JSX.Element {
  if (props.entries.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <dl className="grid gap-2">
      {props.entries.map((entry) => (
        <div key={`${entry.label}:${entry.value}`} className="grid gap-1">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {entry.label}
          </dt>
          <dd className="break-all text-xs text-foreground/80">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function dedupeDeliverablesByIdentity(
  deliverables: DashboardWorkflowDeliverableRecord[],
): DashboardWorkflowDeliverableRecord[] {
  const selectedByIdentity = new Map<string, DashboardWorkflowDeliverableRecord>();

  for (const deliverable of deliverables) {
    const identityKey = readDeliverableIdentityKey(deliverable);
    const existing = selectedByIdentity.get(identityKey);
    if (!existing || compareDeliverablePreference(deliverable, existing) < 0) {
      selectedByIdentity.set(identityKey, deliverable);
    }
  }

  return [...selectedByIdentity.values()].sort(compareDeliverables);
}

function compareDeliverables(
  left: DashboardWorkflowDeliverableRecord,
  right: DashboardWorkflowDeliverableRecord,
): number {
  return (
    readStageWeight(left) - readStageWeight(right) ||
    readDeliverableTimestamp(right) - readDeliverableTimestamp(left) ||
    compareDeliverablePreference(left, right)
  );
}

function compareDeliverablePreference(
  left: DashboardWorkflowDeliverableRecord,
  right: DashboardWorkflowDeliverableRecord,
): number {
  return (
    readDeliverableRichnessRank(left) - readDeliverableRichnessRank(right) ||
    right.descriptor_id.localeCompare(left.descriptor_id)
  );
}

function readStageWeight(deliverable: DashboardWorkflowDeliverableRecord): number {
  return deliverable.delivery_stage === 'final' ? 0 : 1;
}

function readDeliverableTimestamp(deliverable: DashboardWorkflowDeliverableRecord): number {
  return readTimestamp(deliverable.updated_at ?? deliverable.created_at);
}

function readDeliverableRichnessRank(deliverable: DashboardWorkflowDeliverableRecord): number {
  let score = 0;
  if (deliverable.descriptor_kind === 'deliverable_packet') {
    score += 16;
  }
  if (deliverable.summary_brief) {
    score += 8;
  }
  if (deliverable.source_brief_id) {
    score += 4;
  }
  if (Object.keys(deliverable.content_preview ?? {}).length > 0) {
    score += 2;
  }
  if (deliverable.primary_target.artifact_id) {
    score += 1;
  }
  return -score;
}

function readDeliverableIdentityKey(deliverable: DashboardWorkflowDeliverableRecord): string {
  const scopeKey = deliverable.work_item_id ?? 'workflow';
  const target = deliverable.primary_target;
  if (target.artifact_id) {
    return `${scopeKey}:artifact:${target.artifact_id}`;
  }
  if (target.url) {
    return `${scopeKey}:url:${target.url}`;
  }
  if (target.path) {
    return `${scopeKey}:path:${target.path}`;
  }
  return `${scopeKey}:descriptor:${deliverable.descriptor_id}`;
}

function readTimestamp(value: string): number {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function buildDeliverablesScopeDescription(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemTitle: string | null,
): string {
  if (scopeKind === 'workflow') {
    return 'Showing all deliverables recorded across this workflow, with Final entries first and newest entries at the top.';
  }

  const workItemTitle = readText(selectedWorkItemTitle);
  return workItemTitle
    ? `Showing only deliverables recorded for ${workItemTitle}.`
    : 'Showing only deliverables recorded for the selected work item.';
}

function buildEmptyMessage(
  scopeKind: WorkflowWorkbenchScopeDescriptor['scopeKind'],
  selectedWorkItemTitle: string | null,
): string {
  if (scopeKind === 'workflow') {
    return 'No deliverables are recorded for this workflow yet.';
  }

  const workItemTitle = readText(selectedWorkItemTitle);
  return workItemTitle
    ? `No deliverables are recorded for ${workItemTitle} yet.`
    : 'No deliverables are recorded for this work item yet.';
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
