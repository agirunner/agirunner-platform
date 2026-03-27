import type { WorkflowRailService, WorkflowRailQuery } from './workflow-rail-service.js';
import type { WorkflowWorkspaceService } from './workflow-workspace-service.js';
import {
  parseWorkflowOperationsCursor,
  type WorkflowOperationsStreamBatch,
  type WorkflowOperationsStreamEvent,
} from './workflow-operations-types.js';

interface WorkspaceBatchQuery {
  afterCursor?: string;
  boardMode?: string;
  boardFilters?: string;
  workItemId?: string;
  tabScope?: 'workflow' | 'selected_work_item';
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
      events: buildWorkspaceEvents(workspace, query.afterCursor),
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
  afterCursor?: string,
): WorkflowOperationsStreamEvent[] {
  if (requiresReset(afterCursor, workspace.latest_event_id)) {
    return [buildResetEvent(workspace.snapshot_version, workspace.workflow_id, afterCursor ?? '')];
  }
  if (afterCursor === workspace.snapshot_version) {
    return [];
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
    eventEnvelope('steering_replace', workspace.snapshot_version, workspace.workflow_id, workspace.steering_panel),
    eventEnvelope('live_console_append', workspace.snapshot_version, workspace.workflow_id, workspace.live_console.items),
    eventEnvelope('history_replace', workspace.snapshot_version, workspace.workflow_id, workspace.history_timeline),
    eventEnvelope('inputs_replace', workspace.snapshot_version, workspace.workflow_id, workspace.deliverables_panel.inputs_and_provenance),
    eventEnvelope('redrive_lineage_update', workspace.snapshot_version, workspace.workflow_id, workspace.redrive_lineage),
  ];
  for (const deliverable of [
    ...workspace.deliverables_panel.final_deliverables,
    ...workspace.deliverables_panel.in_progress_deliverables,
  ]) {
    events.push(
      eventEnvelope('deliverable_upsert', workspace.snapshot_version, workspace.workflow_id, deliverable),
    );
  }
  return events;
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
