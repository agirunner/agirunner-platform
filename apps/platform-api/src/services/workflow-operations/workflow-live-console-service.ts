import type { MissionControlHistoryResponse } from './mission-control-types.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import type { WorkflowOperatorUpdateRecord } from '../workflow-operator-update-service.js';
import type { LogRow } from '../../logging/log-service.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowLiveConsoleItem,
  type WorkflowLiveConsolePacket,
} from './workflow-operations-types.js';
import { buildExecutionTurnItems } from './workflow-execution-log-composer.js';
import {
  compareCursorTargets,
  paginateOrderedItems,
  resolveFetchWindow,
} from './workflow-packet-cursors.js';

interface VersionSource {
  getHistory(
    tenantId: string,
    input?: { workflowId?: string; limit?: number },
  ): Promise<MissionControlHistoryResponse>;
}

interface BriefSource {
  listBriefs(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; taskId?: string; limit?: number },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

interface UpdateSource {
  listUpdates(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; taskId?: string; limit?: number },
  ): Promise<WorkflowOperatorUpdateRecord[]>;
}

interface VisibilityModeSource {
  getWorkflowSettings(
    tenantId: string,
    workflowId: string,
  ): Promise<{ effective_live_visibility_mode: 'standard' | 'enhanced' }>;
}

interface ExecutionTurnSource {
  query(
    tenantId: string,
    filters: {
      workflowId: string;
      workItemId?: string;
      taskId?: string;
      category: string[];
      operation: string[];
      order: 'desc';
      perPage: number;
    },
  ): Promise<{ data: LogRow[] }>;
}

export class WorkflowLiveConsoleService {
  constructor(
    private readonly versionSource: VersionSource,
    private readonly briefSource: BriefSource,
    private readonly updateSource: UpdateSource,
    private readonly visibilityModeSource: VisibilityModeSource,
    private readonly executionTurnSource?: ExecutionTurnSource,
  ) {}

  async getLiveConsole(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; taskId?: string; after?: string } = {},
  ): Promise<WorkflowLiveConsolePacket> {
    const limit = input.limit ?? 50;
    const fetchWindow = resolveFetchWindow(limit);
    const [version, briefs, updates, workflowSettings] = await Promise.all([
      this.versionSource.getHistory(tenantId, {
        workflowId,
        limit: 1,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        taskId: input.taskId,
        limit: fetchWindow,
      }),
      this.updateSource.listUpdates(tenantId, workflowId, {
        workItemId: input.workItemId,
        taskId: input.taskId,
        limit: fetchWindow,
      }),
      this.visibilityModeSource.getWorkflowSettings(tenantId, workflowId),
    ]);
    const executionTurns = await this.listExecutionTurns(
      tenantId,
      workflowId,
      input,
      fetchWindow,
      workflowSettings.effective_live_visibility_mode,
    );

    const items = [...updates.map(toUpdateItem), ...briefs.map(toBriefItem), ...executionTurns].sort(
      sortNewestFirst,
    );
    const page = paginateOrderedItems(items, limit, input.after, (item) => ({
      timestamp: item.created_at,
      id: item.item_id,
    }));

    return {
      generated_at: version.version.generatedAt,
      latest_event_id: version.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(version.version.latestEventId),
      items: page.items,
      total_count: items.length,
      next_cursor: page.nextCursor,
      live_visibility_mode:
        workflowSettings.effective_live_visibility_mode ?? deriveVisibilityModeFromUpdates(updates),
    };
  }

  private async listExecutionTurns(
    tenantId: string,
    workflowId: string,
    input: { workItemId?: string; taskId?: string },
    fetchWindow: number,
    mode: 'standard' | 'enhanced',
  ): Promise<WorkflowLiveConsoleItem[]> {
    if (mode !== 'enhanced' || !this.executionTurnSource) {
      return [];
    }
    const result = await this.executionTurnSource.query(tenantId, {
      workflowId,
      workItemId: input.workItemId,
      taskId: input.taskId,
      category: ['agent_loop'],
      operation: ['agent.think', 'agent.plan', 'agent.act', 'agent.observe', 'agent.verify'],
      order: 'desc',
      perPage: fetchWindow,
    });
    return buildExecutionTurnItems(result.data);
  }
}

function toBriefItem(brief: WorkflowOperatorBriefRecord): WorkflowLiveConsoleItem {
  const shortBrief = asRecord(brief.short_brief);
  const detailedBrief = asRecord(brief.detailed_brief_json);
  return {
    item_id: brief.id,
    item_kind: 'milestone_brief',
    source_kind: brief.source_kind,
    source_label: readSourceLabel(brief.source_role_name, brief.source_kind),
    headline: readHeadline(shortBrief, detailedBrief, 'Workflow brief'),
    summary: readSummary(detailedBrief, shortBrief),
    created_at: brief.created_at,
    work_item_id: brief.work_item_id,
    task_id: brief.task_id,
    linked_target_ids: buildLinkedTargetIds(brief),
  };
}

function toUpdateItem(update: WorkflowOperatorUpdateRecord): WorkflowLiveConsoleItem {
  const updateKind = readOptionalString(update.update_kind);
  return {
    item_id: update.id,
    item_kind: updateKind === 'platform_notice' ? 'platform_notice' : 'operator_update',
    source_kind: update.source_kind,
    source_label: readSourceLabel(update.source_role_name, update.source_kind),
    headline: readRequiredString(update.headline, 'Workflow update'),
    summary: readOptionalString(update.summary) ?? readRequiredString(update.headline, 'Workflow update'),
    created_at: update.created_at,
    work_item_id: update.work_item_id,
    task_id: update.task_id,
    linked_target_ids: readStringArray(update.linked_target_ids),
  };
}

function buildLinkedTargetIds(record: WorkflowOperatorBriefRecord): string[] {
  const storedTargets = readStringArray(record.linked_target_ids);
  if (storedTargets.length > 0) {
    return storedTargets;
  }
  return [record.workflow_id, record.work_item_id, record.task_id].filter(isNonEmptyString);
}

function readHeadline(
  shortBrief: Record<string, unknown>,
  detailedBrief: Record<string, unknown>,
  fallback: string,
): string {
  return (
    readOptionalString(shortBrief.headline) ??
    readOptionalString(detailedBrief.headline) ??
    fallback
  );
}

function readSummary(
  detailedBrief: Record<string, unknown>,
  shortBrief: Record<string, unknown>,
): string {
  return (
    readOptionalString(detailedBrief.summary) ??
    readOptionalString(shortBrief.delta_label) ??
    readOptionalString(shortBrief.status_label) ??
    readOptionalString(shortBrief.headline) ??
    'Workflow brief'
  );
}

function readRequiredString(value: unknown, fallback: string): string {
  return readOptionalString(value) ?? fallback;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSourceLabel(sourceRoleName: string | null, sourceKind: string): string {
  return readOptionalString(sourceRoleName) ?? humanizeToken(sourceKind);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sortNewestFirst(left: WorkflowLiveConsoleItem, right: WorkflowLiveConsoleItem): number {
  return compareCursorTargets(
    { timestamp: left.created_at, id: left.item_id },
    { timestamp: right.created_at, id: right.item_id },
  );
}

function deriveVisibilityModeFromUpdates(
  updates: WorkflowOperatorUpdateRecord[],
): 'standard' | 'enhanced' {
  return updates.some((update) => update.visibility_mode === 'enhanced')
    ? 'enhanced'
    : 'standard';
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
