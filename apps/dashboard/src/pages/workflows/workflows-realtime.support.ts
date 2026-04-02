import type { InfiniteData } from '@tanstack/react-query';

import type {
  DashboardWorkflowDeliverableRecord,
  DashboardWorkflowLiveConsoleItem,
  DashboardWorkflowOperationsStreamBatch,
  DashboardWorkflowOperationsStreamEvent,
  DashboardWorkflowRailPacket,
  DashboardWorkflowRailRow,
  DashboardWorkflowWorkspacePacket,
} from '../../lib/api.js';

export function applyRailStreamBatch(
  packet:
    | DashboardWorkflowRailPacket
    | InfiniteData<DashboardWorkflowRailPacket>
    | undefined,
  batch: DashboardWorkflowOperationsStreamBatch,
):
  | DashboardWorkflowRailPacket
  | InfiniteData<DashboardWorkflowRailPacket>
  | undefined {
  if (!packet) {
    return packet;
  }
  if (isInfiniteRailData(packet)) {
    return {
      ...packet,
      pages: packet.pages.map((page, index) =>
        index === 0 ? applyRailStreamBatchToPacket(page, batch) : page),
    };
  }
  return applyRailStreamBatchToPacket(packet, batch);
}

function applyRailStreamBatchToPacket(
  packet: DashboardWorkflowRailPacket,
  batch: DashboardWorkflowOperationsStreamBatch,
): DashboardWorkflowRailPacket {
  let next: DashboardWorkflowRailPacket = {
    ...packet,
    generated_at: batch.generated_at,
    latest_event_id: batch.latest_event_id,
    snapshot_version: batch.snapshot_version,
    next_cursor: batch.cursor,
  };

  for (const event of batch.events) {
    if (event.event_type !== 'rail_row_upsert') {
      continue;
    }
    const row = readRailRow(event.payload);
    if (!row) {
      continue;
    }
    next = upsertRailRow(next, row);
  }

  return {
    ...next,
    visible_count: next.rows.length + next.ongoing_rows.length,
    selected_workflow_id:
      next.selected_workflow_id
      ?? next.rows[0]?.workflow_id
      ?? next.ongoing_rows[0]?.workflow_id
      ?? null,
  };
}

function isInfiniteRailData(
  value: DashboardWorkflowRailPacket | InfiniteData<DashboardWorkflowRailPacket>,
): value is InfiniteData<DashboardWorkflowRailPacket> {
  const candidate = value as Partial<InfiniteData<DashboardWorkflowRailPacket>>;
  return Array.isArray(candidate.pages) && Array.isArray(candidate.pageParams);
}

export function applyWorkspaceStreamBatch(
  packet: DashboardWorkflowWorkspacePacket | undefined,
  batch: DashboardWorkflowOperationsStreamBatch,
): DashboardWorkflowWorkspacePacket | undefined {
  if (!packet) {
    return packet;
  }

  let next: DashboardWorkflowWorkspacePacket = {
    ...packet,
    generated_at: batch.generated_at,
    latest_event_id: batch.latest_event_id,
    snapshot_version: batch.snapshot_version,
  };

  for (const event of batch.events) {
    next = applyWorkspaceStreamEvent(next, event);
  }

  return next;
}

function applyWorkspaceStreamEvent(
  packet: DashboardWorkflowWorkspacePacket,
  event: DashboardWorkflowOperationsStreamEvent,
): DashboardWorkflowWorkspacePacket {
  switch (event.event_type) {
    case 'workspace_sticky_update':
      return {
        ...packet,
        sticky_strip: readRecord(event.payload) as DashboardWorkflowWorkspacePacket['sticky_strip'],
      };
    case 'workspace_board_update':
      return {
        ...packet,
        board: readRecord(event.payload) as DashboardWorkflowWorkspacePacket['board'],
      };
    case 'workspace_tab_counts_update':
      return {
        ...packet,
        bottom_tabs: {
          ...packet.bottom_tabs,
          counts: readRecord(event.payload) as DashboardWorkflowWorkspacePacket['bottom_tabs']['counts'],
        },
      };
    case 'needs_action_replace':
      return {
        ...packet,
        needs_action: readRecord(event.payload) as unknown as DashboardWorkflowWorkspacePacket['needs_action'],
      };
    case 'steering_replace':
      return {
        ...packet,
        steering: readRecord(event.payload) as DashboardWorkflowWorkspacePacket['steering'],
      };
    case 'live_console_append':
      return {
        ...packet,
        live_console: mergeLiveConsolePacket(packet, event.payload),
      };
    case 'briefs_append':
      return {
        ...packet,
        briefs: mergeBriefsPacket(packet, event.payload),
      };
    case 'history_append':
      return {
        ...packet,
        history: mergeHistoryPacket(packet, event.payload),
      };
    case 'inputs_replace':
      return {
        ...packet,
        deliverables: {
          ...packet.deliverables,
          inputs_and_provenance: readRecord(event.payload) as unknown as DashboardWorkflowWorkspacePacket['deliverables']['inputs_and_provenance'],
        },
      };
    case 'deliverable_upsert':
      return {
        ...packet,
        deliverables: upsertDeliverable(packet.deliverables, event.payload),
      };
    case 'redrive_lineage_update':
      return {
        ...packet,
        redrive_lineage: readRecord(event.payload),
      };
    default:
      return packet;
  }
}

function mergeLiveConsolePacket(
  packet: DashboardWorkflowWorkspacePacket,
  payload: unknown,
): DashboardWorkflowWorkspacePacket['live_console'] {
  const record = readRecord(payload);
  const appendedItems = readArray(record?.items).filter(isLiveConsoleItem);
  const items = dedupeById(
    [...appendedItems, ...packet.live_console.items],
    (item) => item.item_id,
  );
  const nextCounts = readLiveConsoleCounts(record?.counts, packet.live_console.counts);
  const totalCount =
    typeof nextCounts?.all === 'number'
      ? nextCounts.all
      : typeof packet.live_console.total_count === 'number'
        ? Math.max(packet.live_console.total_count, items.length)
        : items.length;

  return {
    ...packet.live_console,
    items,
    counts: nextCounts,
    total_count: totalCount,
    next_cursor: readOptionalText(record?.next_cursor) ?? packet.live_console.next_cursor,
  };
}

function mergeBriefsPacket(
  packet: DashboardWorkflowWorkspacePacket,
  payload: unknown,
): DashboardWorkflowWorkspacePacket['briefs'] {
  const existing = packet.briefs;
  if (!existing) {
    return existing;
  }
  const record = readRecord(payload);
  const appendedItems = readArray(record?.items) as typeof existing.items;
  const items = dedupeById(
    [...appendedItems, ...existing.items],
    (item) => item.brief_id,
  );
  return {
    ...existing,
    items,
    total_count: Math.max(existing.total_count, items.length),
    next_cursor: readOptionalText(record?.next_cursor) ?? existing.next_cursor,
  };
}

function mergeHistoryPacket(
  packet: DashboardWorkflowWorkspacePacket,
  payload: unknown,
): DashboardWorkflowWorkspacePacket['history'] {
  const record = readRecord(payload);
  const appendedItems = readArray(record?.items) as typeof packet.history.items;
  const appendedGroups = readArray(record?.groups) as typeof packet.history.groups;
  const items = dedupeById(
    [...appendedItems, ...packet.history.items],
    (item) => item.item_id,
  );
  const groups = dedupeById(
    [...appendedGroups, ...packet.history.groups],
    (group) => group.group_id,
  );
  return {
    ...packet.history,
    items,
    groups,
    next_cursor: readOptionalText(record?.next_cursor) ?? packet.history.next_cursor,
  };
}

function upsertDeliverable(
  deliverables: DashboardWorkflowWorkspacePacket['deliverables'],
  payload: unknown,
): DashboardWorkflowWorkspacePacket['deliverables'] {
  const record = readRecord(payload) as DashboardWorkflowDeliverableRecord | null;
  if (!record?.descriptor_id) {
    return deliverables;
  }

  const finalDeliverables = removeDeliverableById(deliverables.final_deliverables, record.descriptor_id);
  const inProgressDeliverables = removeDeliverableById(deliverables.in_progress_deliverables, record.descriptor_id);
  if (record.delivery_stage === 'final' || record.state === 'final') {
    return {
      ...deliverables,
      final_deliverables: sortDeliverables([record, ...finalDeliverables]),
      in_progress_deliverables: inProgressDeliverables,
    };
  }
  return {
    ...deliverables,
    final_deliverables: finalDeliverables,
    in_progress_deliverables: sortDeliverables([record, ...inProgressDeliverables]),
  };
}

function upsertRailRow(
  packet: DashboardWorkflowRailPacket,
  row: DashboardWorkflowRailRow,
): DashboardWorkflowRailPacket {
  const nextRows = removeRailRow(packet.rows, row.workflow_id);
  const nextOngoingRows = removeRailRow(packet.ongoing_rows, row.workflow_id);
  if (row.lifecycle === 'ongoing') {
    return {
      ...packet,
      rows: sortRailRows(nextRows),
      ongoing_rows: sortRailRows([row, ...nextOngoingRows]),
    };
  }
  return {
    ...packet,
    rows: sortRailRows([row, ...nextRows]),
    ongoing_rows: sortRailRows(nextOngoingRows),
  };
}

function removeRailRow(rows: DashboardWorkflowRailRow[], workflowId: string): DashboardWorkflowRailRow[] {
  return rows.filter((row) => row.workflow_id !== workflowId);
}

function removeDeliverableById(
  rows: DashboardWorkflowDeliverableRecord[],
  descriptorId: string,
): DashboardWorkflowDeliverableRecord[] {
  return rows.filter((row) => row.descriptor_id !== descriptorId);
}

function sortRailRows(rows: DashboardWorkflowRailRow[]): DashboardWorkflowRailRow[] {
  return [...rows].sort((left, right) => {
    const timeDelta = compareTimestamps(right.last_changed_at, left.last_changed_at);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.workflow_id.localeCompare(right.workflow_id);
  });
}

function sortDeliverables(rows: DashboardWorkflowDeliverableRecord[]): DashboardWorkflowDeliverableRecord[] {
  return [...rows].sort((left, right) => {
    const timeDelta = compareTimestamps(
      right.updated_at ?? right.created_at,
      left.updated_at ?? left.created_at,
    );
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.descriptor_id.localeCompare(right.descriptor_id);
  });
}

function compareTimestamps(left: string | null | undefined, right: string | null | undefined): number {
  const leftValue = Date.parse(left ?? '');
  const rightValue = Date.parse(right ?? '');
  const safeLeft = Number.isNaN(leftValue) ? 0 : leftValue;
  const safeRight = Number.isNaN(rightValue) ? 0 : rightValue;
  return safeLeft - safeRight;
}

function readRailRow(value: unknown): DashboardWorkflowRailRow | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  if (typeof record.workflow_id !== 'string' || record.workflow_id.length === 0) {
    return null;
  }
  return record as unknown as DashboardWorkflowRailRow;
}

function isLiveConsoleItem(value: unknown): value is DashboardWorkflowLiveConsoleItem {
  return Boolean(
    readRecord(value)
    && typeof (value as DashboardWorkflowLiveConsoleItem).item_id === 'string',
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readLiveConsoleCounts(
  value: unknown,
  fallback: DashboardWorkflowWorkspacePacket['live_console']['counts'],
): DashboardWorkflowWorkspacePacket['live_console']['counts'] {
  const record = readRecord(value);
  if (!record) {
    return fallback;
  }
  return {
    all: readOptionalNumber(record.all) ?? fallback?.all,
    turn_updates: readOptionalNumber(record.turn_updates) ?? fallback?.turn_updates,
    briefs: readOptionalNumber(record.briefs) ?? fallback?.briefs,
    steering: readOptionalNumber(record.steering) ?? fallback?.steering,
  };
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function dedupeById<T>(items: T[], readId: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = readId(item);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}
