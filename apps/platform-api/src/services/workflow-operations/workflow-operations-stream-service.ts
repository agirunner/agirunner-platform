import type { WorkflowRailService, WorkflowRailQuery } from './workflow-rail-service.js';
import type { WorkflowWorkspaceService } from './workflow-workspace-service.js';
import {
  parseWorkflowOperationsCursor,
  type WorkflowOperationsStreamBatch,
  type WorkflowOperationsStreamEvent,
} from './workflow-operations-types.js';
import {
  compareCursorTargets,
  filterItemsNewerThanCursor,
  readFirstItemCursor,
} from './workflow-packet-cursors.js';

interface WorkspaceBatchQuery {
  afterCursor?: string;
  boardMode?: string;
  boardFilters?: string;
  workItemId?: string;
  tabScope?: 'workflow' | 'selected_work_item';
  liveConsoleHeadCursor?: string | null;
  historyHeadCursor?: string | null;
  deliverablesHeadCursor?: string | null;
}

export class WorkflowOperationsStreamService {
  constructor(
    private readonly railService: Pick<WorkflowRailService, 'getRail'>,
    private readonly workspaceService: Pick<WorkflowWorkspaceService, 'getWorkspace'>,
  ) {}

  async buildRailBatch(
    tenantId: string,
    query: WorkflowRailQuery & { afterCursor?: string },
  ): Promise<WorkflowOperationsStreamBatch> {
    const rail = await this.railService.getRail(tenantId, query);
    return {
      generated_at: rail.generated_at,
      latest_event_id: rail.latest_event_id,
      snapshot_version: rail.snapshot_version,
      cursor: rail.snapshot_version,
      events: buildRailEvents(rail.rows, rail.snapshot_version, query.afterCursor, rail.latest_event_id),
    };
  }

  async buildWorkspaceBatch(
    tenantId: string,
    workflowId: string,
    query: WorkspaceBatchQuery,
  ): Promise<WorkflowOperationsStreamBatch> {
    const workspace = await this.workspaceService.getWorkspace(tenantId, workflowId, {
      boardMode: query.boardMode,
      boardFilters: query.boardFilters,
      workItemId: query.workItemId,
      tabScope: query.tabScope,
    });
    return {
      generated_at: workspace.generated_at,
      latest_event_id: workspace.latest_event_id,
      snapshot_version: workspace.snapshot_version,
      cursor: workspace.snapshot_version,
      surface_cursors: {
        live_console_head: readFirstItemCursor(workspace.live_console.items, (item) => ({
          timestamp: item.created_at,
          id: item.item_id,
        })),
        history_head: readFirstItemCursor(workspace.history.items, (item) => ({
          timestamp: item.created_at,
          id: item.item_id,
        })),
        deliverables_head: readFirstItemCursor(readOrderedDeliverables(workspace), (deliverable) => ({
          timestamp: String((deliverable.updated_at ?? deliverable.created_at) ?? ''),
          id: String(deliverable.descriptor_id ?? ''),
        })),
      },
      events: buildWorkspaceEvents(workspace, query),
    };
  }
}

function buildRailEvents(
  rows: Array<{ workflow_id: string }>,
  snapshotVersion: string,
  afterCursor?: string,
  latestEventId?: number | null,
): WorkflowOperationsStreamEvent[] {
  if (requiresReset(afterCursor, latestEventId ?? null)) {
    return [buildResetEvent(snapshotVersion, null, afterCursor ?? '')];
  }
  if (afterCursor === snapshotVersion) {
    return [];
  }
  return rows.map((row) => ({
    event_type: 'rail_row_upsert',
    cursor: snapshotVersion,
    snapshot_version: snapshotVersion,
    workflow_id: String(row.workflow_id ?? ''),
    payload: row,
  }));
}

function buildWorkspaceEvents(
  workspace: Awaited<ReturnType<WorkflowWorkspaceService['getWorkspace']>>,
  query: WorkspaceBatchQuery,
): WorkflowOperationsStreamEvent[] {
  const afterCursor = query.afterCursor;
  if (requiresReset(afterCursor, workspace.latest_event_id)) {
    return [buildResetEvent(workspace.snapshot_version, workspace.workflow_id, afterCursor ?? '')];
  }
  const liveConsoleItems = afterCursor
    ? filterItemsNewerThanCursor(
        workspace.live_console.items,
        query.liveConsoleHeadCursor,
        (item) => ({ timestamp: item.created_at, id: item.item_id }),
      )
    : workspace.live_console.items;
  const historyItems = afterCursor
    ? filterItemsNewerThanCursor(
        workspace.history.items,
        query.historyHeadCursor,
        (item) => ({ timestamp: item.created_at, id: item.item_id }),
      )
    : workspace.history.items;
  const deliverables = afterCursor
    ? filterItemsNewerThanCursor(
        readOrderedDeliverables(workspace),
        query.deliverablesHeadCursor,
        (deliverable) => ({
          timestamp: String((deliverable.updated_at ?? deliverable.created_at) ?? ''),
          id: String(deliverable.descriptor_id ?? ''),
        }),
      )
    : readOrderedDeliverables(workspace);

  if (afterCursor === workspace.snapshot_version) {
    const events: WorkflowOperationsStreamEvent[] = [];
    if (liveConsoleItems.length > 0) {
      events.push(
        eventEnvelope('live_console_append', workspace.snapshot_version, workspace.workflow_id, {
          items: liveConsoleItems,
          next_cursor: workspace.live_console.next_cursor,
        }),
      );
    }
    if (historyItems.length > 0) {
      events.push(
        eventEnvelope('history_append', workspace.snapshot_version, workspace.workflow_id, {
          items: historyItems,
          groups: buildHistoryGroups(historyItems),
          next_cursor: workspace.history.next_cursor,
        }),
      );
    }
    for (const deliverable of deliverables) {
      events.push(
        eventEnvelope('deliverable_upsert', workspace.snapshot_version, workspace.workflow_id, deliverable),
      );
    }
    return events;
  }

  const events: WorkflowOperationsStreamEvent[] = [
    eventEnvelope('workspace_sticky_update', workspace.snapshot_version, workspace.workflow_id, workspace.sticky_strip),
    eventEnvelope('workspace_board_update', workspace.snapshot_version, workspace.workflow_id, workspace.board),
    eventEnvelope(
      'workspace_tab_counts_update',
      workspace.snapshot_version,
      workspace.workflow_id,
      workspace.bottom_tabs.counts,
    ),
    eventEnvelope('needs_action_replace', workspace.snapshot_version, workspace.workflow_id, workspace.needs_action),
    eventEnvelope('steering_replace', workspace.snapshot_version, workspace.workflow_id, workspace.steering),
    eventEnvelope('live_console_append', workspace.snapshot_version, workspace.workflow_id, {
      items: liveConsoleItems,
      next_cursor: workspace.live_console.next_cursor,
    }),
    eventEnvelope('history_append', workspace.snapshot_version, workspace.workflow_id, {
      items: historyItems,
      groups: buildHistoryGroups(historyItems),
      next_cursor: workspace.history.next_cursor,
    }),
    eventEnvelope('inputs_replace', workspace.snapshot_version, workspace.workflow_id, workspace.deliverables.inputs_and_provenance),
    eventEnvelope('redrive_lineage_update', workspace.snapshot_version, workspace.workflow_id, workspace.redrive_lineage),
  ];
  for (const deliverable of deliverables) {
    events.push(
      eventEnvelope('deliverable_upsert', workspace.snapshot_version, workspace.workflow_id, deliverable),
    );
  }
  return events;
}

function buildHistoryGroups(items: Array<{ created_at: string; item_id: string }>) {
  const groups = new Map<string, { group_id: string; label: string; anchor_at: string; item_ids: string[] }>();
  for (const item of items) {
    const groupId = item.created_at.slice(0, 10);
    const existing = groups.get(groupId) ?? {
      group_id: groupId,
      label: groupId,
      anchor_at: `${groupId}T00:00:00.000Z`,
      item_ids: [],
    };
    existing.item_ids.push(item.item_id);
    groups.set(groupId, existing);
  }
  return [...groups.values()].sort((left, right) => right.anchor_at.localeCompare(left.anchor_at));
}

function readOrderedDeliverables(
  workspace: Awaited<ReturnType<WorkflowWorkspaceService['getWorkspace']>>,
): Array<Record<string, unknown>> {
  return [
    ...(workspace.deliverables.final_deliverables as Array<Record<string, unknown>>),
    ...(workspace.deliverables.in_progress_deliverables as Array<Record<string, unknown>>),
  ].sort((left, right) =>
    compareCursorTargets(
      {
        timestamp: String((left.updated_at ?? left.created_at) ?? ''),
        id: String(left.descriptor_id ?? ''),
      },
      {
        timestamp: String((right.updated_at ?? right.created_at) ?? ''),
        id: String(right.descriptor_id ?? ''),
      },
    ));
}

function requiresReset(afterCursor: string | undefined, latestEventId: number | null): boolean {
  if (!afterCursor) {
    return false;
  }
  const parsed = parseWorkflowOperationsCursor(afterCursor);
  if (parsed === null) {
    return true;
  }
  if (latestEventId === null) {
    return false;
  }
  return parsed + 1000 < latestEventId;
}

function buildResetEvent(
  snapshotVersion: string,
  workflowId: string | null,
  cursor: string,
): WorkflowOperationsStreamEvent {
  return {
    event_type: 'reset_required',
    cursor,
    snapshot_version: snapshotVersion,
    workflow_id: workflowId,
    payload: {
      reason: 'cursor_expired',
      recommended_action: 'reload_snapshot',
    },
  };
}

function eventEnvelope(
  eventType: string,
  snapshotVersion: string,
  workflowId: string,
  payload: unknown,
): WorkflowOperationsStreamEvent {
  return {
    event_type: eventType,
    cursor: snapshotVersion,
    snapshot_version: snapshotVersion,
    workflow_id: workflowId,
    payload,
  };
}
