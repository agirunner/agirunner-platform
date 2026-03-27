import type {
  MissionControlHistoryResponse,
  MissionControlLiveResponse,
  MissionControlPacket,
  MissionControlRecentResponse,
  MissionControlWorkflowCard,
} from './mission-control-types.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowRailMode,
  type WorkflowRailPacket,
  type WorkflowRailRow,
} from './workflow-operations-types.js';

interface LiveRailSource {
  getLive(
    tenantId: string,
    input?: { page?: number; perPage?: number },
  ): Promise<MissionControlLiveResponse>;
  listWorkflowCards(
    tenantId: string,
    input?: { workflowIds?: string[]; page?: number; perPage?: number },
  ): Promise<MissionControlWorkflowCard[]>;
}

interface RecentRailSource {
  getRecent(tenantId: string, input?: { limit?: number }): Promise<MissionControlRecentResponse>;
}

interface HistoryRailSource {
  getHistory(
    tenantId: string,
    input?: { workflowId?: string; limit?: number },
  ): Promise<MissionControlHistoryResponse>;
}

export interface WorkflowRailQuery {
  mode: WorkflowRailMode;
  needsActionOnly?: boolean;
  ongoingOnly?: boolean;
  search?: string;
  page?: number;
  perPage?: number;
  selectedWorkflowId?: string;
}

export class WorkflowRailService {
  constructor(
    private readonly liveSource: LiveRailSource,
    private readonly recentSource: RecentRailSource,
    private readonly historySource: HistoryRailSource,
  ) {}

  async getRail(tenantId: string, query: WorkflowRailQuery): Promise<WorkflowRailPacket> {
    switch (query.mode) {
      case 'recent':
        return this.buildRecentRail(tenantId, query);
      case 'history':
        return this.buildHistoryRail(tenantId, query);
      case 'live':
      default:
        return this.buildLiveRail(tenantId, query);
    }
  }

  async getWorkflowCard(tenantId: string, workflowId: string): Promise<MissionControlWorkflowCard | null> {
    const cards = await this.liveSource.listWorkflowCards(tenantId, {
      workflowIds: [workflowId],
      page: 1,
      perPage: 1,
    });
    return cards[0] ?? null;
  }

  private async buildLiveRail(tenantId: string, query: WorkflowRailQuery): Promise<WorkflowRailPacket> {
    const response = await this.liveSource.getLive(tenantId, {
      page: query.page ?? 1,
      perPage: query.perPage ?? 100,
    });
    const rows = applyRailFilters(
      dedupeRows(response.sections.flatMap((section) => section.workflows.map(toRailRowFromCard))),
      query,
    );
    return buildRailPacket('live', response.version.generatedAt, response.version.latestEventId, rows, query);
  }

  private async buildRecentRail(tenantId: string, query: WorkflowRailQuery): Promise<WorkflowRailPacket> {
    const response = await this.recentSource.getRecent(tenantId, { limit: query.perPage ?? 100 });
    const rows = applyRailFilters(
      dedupeRows(response.packets.map(toRailRowFromPacket)),
      query,
    );
    return buildRailPacket('recent', response.version.generatedAt, response.version.latestEventId, rows, query);
  }

  private async buildHistoryRail(tenantId: string, query: WorkflowRailQuery): Promise<WorkflowRailPacket> {
    const response = await this.historySource.getHistory(tenantId, { limit: query.perPage ?? 100 });
    const rows = applyRailFilters(
      dedupeRows(response.packets.map(toRailRowFromPacket)),
      query,
    );
    return buildRailPacket('history', response.version.generatedAt, response.version.latestEventId, rows, query);
  }
}

function buildRailPacket(
  mode: WorkflowRailMode,
  generatedAt: string,
  latestEventId: number | null,
  rows: WorkflowRailRow[],
  query: WorkflowRailQuery,
): WorkflowRailPacket {
  const selectedWorkflowId = selectWorkflowId(rows, query.selectedWorkflowId);
  return {
    mode,
    generated_at: generatedAt,
    latest_event_id: latestEventId,
    snapshot_version: buildWorkflowOperationsSnapshotVersion(latestEventId),
    rows,
    ongoing_rows: rows.filter((row) => row.lifecycle === 'ongoing'),
    selected_workflow_id: selectedWorkflowId,
    next_cursor: null,
  };
}

function selectWorkflowId(rows: WorkflowRailRow[], selectedWorkflowId?: string): string | null {
  if (selectedWorkflowId && rows.some((row) => row.workflow_id === selectedWorkflowId)) {
    return selectedWorkflowId;
  }
  return rows[0]?.workflow_id ?? null;
}

function dedupeRows(rows: WorkflowRailRow[]): WorkflowRailRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.workflow_id)) {
      return false;
    }
    seen.add(row.workflow_id);
    return true;
  });
}

function applyRailFilters(rows: WorkflowRailRow[], query: WorkflowRailQuery): WorkflowRailRow[] {
  return rows.filter((row) => {
    if (query.needsActionOnly && !row.needs_action) {
      return false;
    }
    if (query.ongoingOnly && row.lifecycle !== 'ongoing') {
      return false;
    }
    if (!query.search) {
      return true;
    }
    const haystack = [
      row.name,
      row.workspace_name,
      row.playbook_name,
      row.live_summary,
      row.workflow_id,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(query.search.toLowerCase());
  });
}

function toRailRowFromCard(card: MissionControlWorkflowCard): WorkflowRailRow {
  return {
    workflow_id: card.id,
    name: card.name,
    state: card.state ?? null,
    lifecycle: card.lifecycle ?? null,
    current_stage: card.currentStage ?? null,
    workspace_name: card.workspaceName ?? null,
    playbook_name: card.playbookName ?? null,
    posture: card.posture ?? null,
    live_summary: card.pulse.summary,
    last_changed_at: card.metrics.lastChangedAt ?? card.pulse.updatedAt ?? null,
    needs_action:
      card.attentionLane === 'needs_decision'
      || card.attentionLane === 'needs_intervention'
      || card.posture === 'needs_decision'
      || card.posture === 'needs_intervention'
      || card.posture === 'recoverable_needs_steering'
      || card.posture === 'terminal_failed',
    counts: {
      active_task_count: card.metrics.activeTaskCount,
      active_work_item_count: card.metrics.activeWorkItemCount,
      blocked_work_item_count: card.metrics.blockedWorkItemCount,
      open_escalation_count: card.metrics.openEscalationCount,
      waiting_for_decision_count: card.metrics.waitingForDecisionCount,
      failed_task_count: card.metrics.failedTaskCount,
    },
  };
}

function toRailRowFromPacket(packet: MissionControlPacket): WorkflowRailRow {
  return {
    workflow_id: packet.workflowId,
    name: packet.workflowName ?? packet.workflowId,
    state: null,
    lifecycle: null,
    current_stage: null,
    workspace_name: null,
    playbook_name: null,
    posture: packet.posture ?? null,
    live_summary: packet.summary,
    last_changed_at: packet.changedAt,
    needs_action: Boolean(packet.carryover),
    counts: {
      active_task_count: 0,
      active_work_item_count: 0,
      blocked_work_item_count: 0,
      open_escalation_count: 0,
      waiting_for_decision_count: 0,
      failed_task_count: 0,
    },
  };
}
