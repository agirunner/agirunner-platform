import type { MissionControlHistoryResponse } from './mission-control-types.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator/workflow-operator-brief-service.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowBriefItem,
  type WorkflowBriefsPacket,
} from './workflow-operations-types.js';
import {
  paginateOrderedItems,
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
    input?: { workItemId?: string; taskId?: string; limit?: number; unbounded?: boolean },
  ): Promise<WorkflowOperatorBriefRecord[]>;
}

export class WorkflowBriefsService {
  constructor(
    private readonly versionSource: VersionSource,
    private readonly briefSource: BriefSource,
  ) {}

  async getBriefs(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; taskId?: string; after?: string } = {},
  ): Promise<WorkflowBriefsPacket> {
    const limit = input.limit ?? 50;
    const [version, briefs] = await Promise.all([
      this.versionSource.getHistory(tenantId, {
        workflowId,
        limit: 1,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        taskId: input.taskId,
        unbounded: true,
      }),
    ]);
    const items = briefs.map(toWorkflowBriefItem).sort(sortNewestFirst);
    const page = paginateOrderedItems(items, limit, input.after, (item) => ({
      timestamp: item.created_at,
      id: item.brief_id,
    }));

    return {
      generated_at: version.version.generatedAt,
      latest_event_id: version.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(version.version.latestEventId),
      items: page.items,
      total_count: items.length,
      next_cursor: page.nextCursor,
    };
  }
}

function toWorkflowBriefItem(brief: WorkflowOperatorBriefRecord): WorkflowBriefItem {
  const shortBrief = asRecord(brief.short_brief);
  const detailedBrief = asRecord(brief.detailed_brief_json);
  return {
    brief_id: brief.id,
    workflow_id: brief.workflow_id,
    work_item_id: brief.work_item_id,
    task_id: brief.task_id,
    request_id: brief.request_id,
    execution_context_id: brief.execution_context_id,
    brief_kind: brief.brief_kind,
    brief_scope: brief.brief_scope,
    source_kind: brief.source_kind,
    source_label: readSourceLabel(brief.source_role_name, brief.source_kind),
    source_role_name: brief.source_role_name,
    headline: readOptionalString(shortBrief.headline) ?? readOptionalString(detailedBrief.headline) ?? 'Workflow brief',
    summary:
      readOptionalString(detailedBrief.summary)
      ?? readOptionalString(shortBrief.headline)
      ?? 'Workflow brief',
    llm_turn_count: brief.llm_turn_count,
    status_kind: brief.status_kind,
    short_brief: brief.short_brief,
    detailed_brief_json: brief.detailed_brief_json,
    linked_target_ids: brief.linked_target_ids,
    sequence_number: brief.sequence_number,
    related_artifact_ids: brief.related_artifact_ids,
    related_output_descriptor_ids: brief.related_output_descriptor_ids,
    related_intervention_ids: brief.related_intervention_ids,
    canonical_workflow_brief_id: brief.canonical_workflow_brief_id,
    created_by_type: brief.created_by_type,
    created_by_id: brief.created_by_id,
    created_at: brief.created_at,
    updated_at: brief.updated_at,
  };
}

function sortNewestFirst(
  left: Pick<WorkflowBriefItem, 'created_at' | 'brief_id'>,
  right: Pick<WorkflowBriefItem, 'created_at' | 'brief_id'>,
): number {
  return right.created_at.localeCompare(left.created_at) || right.brief_id.localeCompare(left.brief_id);
}

function readSourceLabel(sourceRoleName: string | null, sourceKind: string): string {
  return readOptionalString(sourceRoleName) ?? humanizeToken(sourceKind);
}

function humanizeToken(value: string): string {
  return value
    .split(/[_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(' ');
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
