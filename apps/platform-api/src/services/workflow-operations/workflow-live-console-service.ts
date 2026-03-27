import type { MissionControlHistoryResponse } from './mission-control-types.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import type { WorkflowOperatorUpdateRecord } from '../workflow-operator-update-service.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowLiveConsoleItem,
  type WorkflowLiveConsolePacket,
} from './workflow-operations-types.js';

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
    input?: { workItemId?: string; limit?: number },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

interface UpdateSource {
  listUpdates(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; limit?: number },
  ): Promise<WorkflowOperatorUpdateRecord[]>;
}

export class WorkflowLiveConsoleService {
  constructor(
    private readonly versionSource: VersionSource,
    private readonly briefSource: BriefSource,
    private readonly updateSource: UpdateSource,
  ) {}

  async getLiveConsole(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string } = {},
  ): Promise<WorkflowLiveConsolePacket> {
    const limit = input.limit ?? 50;
    const [version, briefs, updates] = await Promise.all([
      this.versionSource.getHistory(tenantId, {
        workflowId,
        limit: 1,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
      this.updateSource.listUpdates(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
    ]);

    const items = [...updates.map(toUpdateItem), ...briefs.map(toBriefItem)]
      .sort(sortNewestFirst)
      .slice(0, limit);

    return {
      generated_at: version.version.generatedAt,
      latest_event_id: version.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(version.version.latestEventId),
      items,
      next_cursor: null,
    };
  }
}

function toBriefItem(brief: WorkflowOperatorBriefRecord): WorkflowLiveConsoleItem {
  const shortBrief = asRecord(brief.short_brief);
  const detailedBrief = asRecord(brief.detailed_brief_json);
  return {
    item_id: brief.id,
    item_kind: 'milestone_brief',
    headline: readHeadline(shortBrief, detailedBrief, 'Workflow brief'),
    summary: readSummary(detailedBrief, shortBrief),
    created_at: brief.created_at,
    linked_target_ids: buildLinkedTargetIds(brief),
  };
}

function toUpdateItem(update: WorkflowOperatorUpdateRecord): WorkflowLiveConsoleItem {
  const updateKind = readOptionalString(update.update_kind);
  return {
    item_id: update.id,
    item_kind: updateKind === 'platform_notice' ? 'platform_notice' : 'operator_update',
    headline: readRequiredString(update.headline, 'Workflow update'),
    summary: readOptionalString(update.summary) ?? readRequiredString(update.headline, 'Workflow update'),
    created_at: update.created_at,
    linked_target_ids: readStringArray(update.linked_target_ids),
  };
}

function buildLinkedTargetIds(record: WorkflowOperatorBriefRecord): string[] {
  return [record.workflow_id, record.work_item_id, record.task_id].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
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

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sortNewestFirst(left: WorkflowLiveConsoleItem, right: WorkflowLiveConsoleItem): number {
  return right.created_at.localeCompare(left.created_at);
}
