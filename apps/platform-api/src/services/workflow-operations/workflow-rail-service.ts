import type {
  MissionControlHistoryResponse,
  MissionControlLiveResponse,
  MissionControlPacket,
  MissionControlRecentResponse,
  MissionControlWorkflowCard,
} from './mission-control-types.js';
import { readUuidOrUndefined } from '../../lib/uuid.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowRailMode,
  type WorkflowRailPacket,
  type WorkflowRailRow,
} from './workflow-operations-types.js';

interface LiveRailSource {
  getLive(
    tenantId: string,
    input?: { page?: number; perPage?: number; lifecycleFilter?: WorkflowRailLifecycleFilter },
  ): Promise<MissionControlLiveResponse>;
  countWorkflows?(
    tenantId: string,
    input?: { lifecycleFilter?: WorkflowRailLifecycleFilter },
  ): Promise<number>;
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
  lifecycleFilter?: WorkflowRailLifecycleFilter;
  search?: string;
  page?: number;
  perPage?: number;
  selectedWorkflowId?: string;
}

export type WorkflowRailLifecycleFilter = 'all' | 'ongoing' | 'planned';

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
    const [response, totalCount] = await Promise.all([
      this.liveSource.getLive(tenantId, {
        page: query.page ?? 1,
        perPage: query.perPage ?? 100,
        lifecycleFilter: query.lifecycleFilter ?? 'all',
      }),
      this.liveSource.countWorkflows?.(tenantId, {
        lifecycleFilter: query.lifecycleFilter ?? 'all',
      }) ?? Promise.resolve(0),
    ]);
    const selectedRow = query.selectedWorkflowId
      ? await this.readSelectedLiveRow(tenantId, query.selectedWorkflowId)
      : null;
    const filteredRows = applyRailFilters(
      dedupeRows(response.sections.flatMap((section) => readSectionRows(section))),
      query,
    );
    const allRows = dedupeRows(pinSelectedRow(filteredRows, selectedRow));
    const ongoingRows = allRows.filter((row) => row.lifecycle === 'ongoing');
    const primaryRows = allRows.filter((row) => row.lifecycle !== 'ongoing');
    return buildRailPacket(
      'live',
      response.version.generatedAt,
      response.version.latestEventId,
      primaryRows,
      ongoingRows,
      totalCount,
      query,
    );
  }

  private async readSelectedLiveRow(
    tenantId: string,
    workflowId: string,
  ): Promise<WorkflowRailRow | null> {
    const safeWorkflowId = readUuidOrUndefined(workflowId);
    if (!safeWorkflowId) {
      return null;
    }
    const card = await this.getWorkflowCard(tenantId, safeWorkflowId);
    return toRailRowFromCard(card);
  }

  private async buildRecentRail(tenantId: string, query: WorkflowRailQuery): Promise<WorkflowRailPacket> {
    const response = await this.recentSource.getRecent(tenantId, { limit: query.perPage ?? 100 });
    const rows = applyRailFilters(
      dedupeRows(response.packets.map(toRailRowFromPacket)),
      query,
    );
    return buildRailPacket(
      'recent',
      response.version.generatedAt,
      response.version.latestEventId,
      rows,
      [],
      rows.length,
      query,
    );
  }

  private async buildHistoryRail(tenantId: string, query: WorkflowRailQuery): Promise<WorkflowRailPacket> {
    const response = await this.historySource.getHistory(tenantId, { limit: query.perPage ?? 100 });
    const rows = applyRailFilters(
      dedupeRows(response.packets.map(toRailRowFromPacket)),
      query,
    );
    return buildRailPacket(
      'history',
      response.version.generatedAt,
      response.version.latestEventId,
      rows,
      [],
      rows.length,
      query,
    );
  }
}

function buildRailPacket(
  mode: WorkflowRailMode,
  generatedAt: string,
  latestEventId: number | null,
  rows: WorkflowRailRow[],
  ongoingRows: WorkflowRailRow[],
  totalCount: number,
  query: WorkflowRailQuery,
): WorkflowRailPacket {
  const selectedWorkflowId = selectWorkflowId([...rows, ...ongoingRows], query.selectedWorkflowId);
  const visibleCount = rows.length + ongoingRows.length;
  return {
    mode,
    generated_at: generatedAt,
    latest_event_id: latestEventId,
    snapshot_version: buildWorkflowOperationsSnapshotVersion(latestEventId),
    rows,
    ongoing_rows: ongoingRows,
    selected_workflow_id: selectedWorkflowId,
    visible_count: visibleCount,
    total_count: totalCount > 0 ? totalCount : visibleCount,
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

function pinSelectedRow(
  rows: WorkflowRailRow[],
  selectedRow: WorkflowRailRow | null,
): WorkflowRailRow[] {
  if (!selectedRow) {
    return rows;
  }
  return [selectedRow, ...rows];
}

function applyRailFilters(rows: WorkflowRailRow[], query: WorkflowRailQuery): WorkflowRailRow[] {
  return rows.filter((row) => {
    if (query.lifecycleFilter === 'ongoing' && row.lifecycle !== 'ongoing') {
      return false;
    }
    if (query.lifecycleFilter === 'planned' && row.lifecycle !== 'planned') {
      return false;
    }
    if (query.needsActionOnly && !row.needs_action) {
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

function readSectionCards(section: { workflows?: MissionControlWorkflowCard[] | null }): MissionControlWorkflowCard[] {
  return Array.isArray(section.workflows) ? section.workflows : [];
}

function readSectionRows(section: { workflows?: MissionControlWorkflowCard[] | null }): WorkflowRailRow[] {
  return readSectionCards(section)
    .map((card) => toRailRowFromCard(card))
    .filter((row): row is WorkflowRailRow => row !== null);
}

function toRailRowFromCard(card: MissionControlWorkflowCard | null): WorkflowRailRow | null {
  if (!card || typeof card.id !== 'string' || card.id.length === 0) {
    return null;
  }
  const pulse = card.pulse ?? { summary: '', updatedAt: null };
  const metrics = card.metrics ?? {
    activeTaskCount: 0,
    activeWorkItemCount: 0,
    blockedWorkItemCount: 0,
    openEscalationCount: 0,
    waitingForDecisionCount: 0,
    failedTaskCount: 0,
    recoverableIssueCount: 0,
    lastChangedAt: null,
  };
  return {
    workflow_id: card.id,
    name: card.name ?? card.id,
    state: card.state ?? null,
    lifecycle: card.lifecycle ?? null,
    current_stage: card.currentStage ?? null,
    workspace_name: card.workspaceName ?? null,
    playbook_name: card.playbookName ?? null,
    posture: card.posture ?? null,
    live_summary: pulse.summary ?? '',
    last_changed_at: metrics.lastChangedAt ?? pulse.updatedAt ?? null,
    needs_action: hasConcreteNeedsAction(card),
    counts: {
      active_task_count: metrics.activeTaskCount,
      active_work_item_count: metrics.activeWorkItemCount,
      blocked_work_item_count: metrics.blockedWorkItemCount,
      open_escalation_count: metrics.openEscalationCount,
      waiting_for_decision_count: metrics.waitingForDecisionCount,
      failed_task_count: metrics.failedTaskCount,
    },
  };
}

function hasConcreteNeedsAction(card: MissionControlWorkflowCard): boolean {
  const metrics = card.metrics ?? {
    activeTaskCount: 0,
    activeWorkItemCount: 0,
    blockedWorkItemCount: 0,
    openEscalationCount: 0,
    waitingForDecisionCount: 0,
    failedTaskCount: 0,
    recoverableIssueCount: 0,
    lastChangedAt: null,
  };
  if (
    metrics.waitingForDecisionCount > 0
    || metrics.openEscalationCount > 0
    || metrics.blockedWorkItemCount > 0
    || metrics.failedTaskCount > 0
    || metrics.recoverableIssueCount > 0
  ) {
    return true;
  }
  return false;
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
