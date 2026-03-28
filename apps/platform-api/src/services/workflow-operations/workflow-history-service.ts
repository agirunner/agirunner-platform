import type { MissionControlHistoryResponse } from './mission-control-types.js';
import type { WorkflowInputPacketRecord } from '../workflow-input-packet-service.js';
import type { WorkflowInterventionRecord } from '../workflow-intervention-service.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowHistoryGroup,
  type WorkflowHistoryItem,
  type WorkflowHistoryPacket,
} from './workflow-operations-types.js';
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
  ): Promise<unknown>;
}

interface InterventionSource {
  listWorkflowInterventions(tenantId: string, workflowId: string): Promise<WorkflowInterventionRecord[]>;
}

interface InputPacketSource {
  listWorkflowInputPackets(tenantId: string, workflowId: string): Promise<WorkflowInputPacketRecord[]>;
}

interface DeliverableSource {
  listDeliverables(
    tenantId: string,
    workflowId: string,
    input?: { workItemId?: string; limit?: number },
  ): Promise<unknown>;
}

export class WorkflowHistoryService {
  constructor(
    private readonly versionSource: VersionSource,
    private readonly briefSource: BriefSource,
    private readonly updateSource: UpdateSource,
    private readonly interventionSource: InterventionSource,
    private readonly inputPacketSource: InputPacketSource,
    private readonly deliverableSource: DeliverableSource,
  ) {}

  async getHistory(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string; taskId?: string; after?: string } = {},
  ): Promise<WorkflowHistoryPacket> {
    const limit = input.limit ?? 100;
    const fetchWindow = resolveFetchWindow(limit);
    const [version, briefs, interventions, inputPackets, deliverables] = await Promise.all([
      this.versionSource.getHistory(tenantId, {
        workflowId,
        limit: 1,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        taskId: input.taskId,
        limit: fetchWindow,
      }),
      this.interventionSource.listWorkflowInterventions(tenantId, workflowId),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
      this.deliverableSource.listDeliverables(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit: fetchWindow,
      }),
    ]);

    const items = [
      ...briefs.map(toBriefHistoryItem),
      ...deliverables.map(toDeliverableHistoryItem),
      ...filterByWorkItem(interventions, input.workItemId).map(toInterventionHistoryItem),
      ...filterInputPackets(inputPackets, input.workItemId).map(toInputHistoryItem),
    ]
      .sort(sortNewestFirst)
    const page = paginateOrderedItems(items, limit, input.after, (item) => ({
      timestamp: item.created_at,
      id: item.item_id,
    }));

    return {
      generated_at: version.version.generatedAt,
      latest_event_id: version.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(version.version.latestEventId),
      groups: buildGroups(page.items),
      items: page.items,
      filters: {
        available: ['briefs', 'deliverables', 'interventions', 'inputs', 'redrives'],
        active: [],
      },
      next_cursor: page.nextCursor,
    };
  }
}

function filterByWorkItem<T extends { work_item_id: string | null }>(records: T[], workItemId?: string): T[] {
  if (!workItemId) {
    return records;
  }
  return records.filter((record) => record.work_item_id === workItemId);
}

function filterInputPackets(records: WorkflowInputPacketRecord[], workItemId?: string): WorkflowInputPacketRecord[] {
  if (!workItemId) {
    return records;
  }
  return records.filter((record) => {
    const recordWorkItemId = record.work_item_id;
    return recordWorkItemId === null || recordWorkItemId === workItemId;
  });
}

function buildGroups(items: WorkflowHistoryItem[]): WorkflowHistoryGroup[] {
  const idsByDay = new Map<string, string[]>();
  for (const item of items) {
    const groupId = item.created_at.slice(0, 10);
    const itemIds = idsByDay.get(groupId) ?? [];
    itemIds.push(item.item_id);
    idsByDay.set(groupId, itemIds);
  }
  return Array.from(idsByDay.entries()).map(([groupId, itemIds]) => ({
    group_id: groupId,
    label: groupId,
    anchor_at: `${groupId}T00:00:00.000Z`,
    item_ids: itemIds,
  }));
}

function toBriefHistoryItem(brief: WorkflowOperatorBriefRecord): WorkflowHistoryItem {
  const shortBrief = asRecord(brief.short_brief);
  const detailedBrief = asRecord(brief.detailed_brief_json);
  return {
    item_id: brief.id,
    item_kind: 'milestone_brief',
    source_kind: brief.source_kind,
    source_label: readSourceLabel(brief.source_role_name, brief.source_kind),
    headline: readOptionalString(shortBrief.headline) ?? readOptionalString(detailedBrief.headline) ?? 'Workflow brief',
    summary: readOptionalString(detailedBrief.summary) ?? readOptionalString(shortBrief.headline) ?? 'Workflow brief',
    created_at: brief.created_at,
    linked_target_ids: buildLinkedTargetIds(brief),
  };
}

function toInterventionHistoryItem(intervention: WorkflowInterventionRecord): WorkflowHistoryItem {
  return {
    item_id: intervention.id,
    item_kind: 'intervention',
    source_kind: intervention.origin,
    source_label: humanizeToken(intervention.origin),
    headline: readRequiredString(intervention.summary, 'Workflow intervention'),
    summary: readOptionalString(intervention.note) ?? readRequiredString(intervention.summary, 'Workflow intervention'),
    created_at: intervention.created_at,
    linked_target_ids: buildLinkedTargetIds(intervention),
  };
}

function toDeliverableHistoryItem(deliverable: {
  descriptor_id: string;
  title: string;
  summary_brief: string | null;
  updated_at: string;
  created_at: string;
  workflow_id: string;
  work_item_id: string | null;
}): WorkflowHistoryItem {
  return {
    item_id: deliverable.descriptor_id,
    item_kind: 'deliverable',
    source_kind: 'deliverable',
    source_label: 'Deliverable',
    headline: deliverable.title,
    summary: readOptionalString(deliverable.summary_brief) ?? deliverable.title,
    created_at: deliverable.updated_at ?? deliverable.created_at,
    linked_target_ids: buildLinkedTargetIds(deliverable),
  };
}

function toInputHistoryItem(packet: WorkflowInputPacketRecord): WorkflowHistoryItem {
  const packetKind = readOptionalString(packet.packet_kind);
  return {
    item_id: packet.id,
    item_kind: packetKind === 'redrive_patch' ? 'redrive' : 'input',
    source_kind: packet.source,
    source_label: humanizeToken(packet.source),
    headline: readOptionalString(packet.summary) ?? humanizePacketKind(packetKind),
    summary: readOptionalString(packet.summary) ?? humanizePacketKind(packetKind),
    created_at: packet.created_at,
    linked_target_ids: buildLinkedTargetIds(packet),
  };
}

function buildLinkedTargetIds(
  record:
    | WorkflowOperatorBriefRecord
    | WorkflowInterventionRecord
    | WorkflowInputPacketRecord
    | { workflow_id: string; work_item_id: string | null; task_id?: string | null },
): string[] {
  const targets = [
    record.workflow_id,
    record.work_item_id,
    'task_id' in record ? record.task_id : null,
  ];
  return targets.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function humanizePacketKind(packetKind: string | null): string {
  if (!packetKind) {
    return 'Workflow input';
  }
  return humanizeToken(packetKind);
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sortNewestFirst(left: WorkflowHistoryItem, right: WorkflowHistoryItem): number {
  return compareCursorTargets(
    { timestamp: left.created_at, id: left.item_id },
    { timestamp: right.created_at, id: right.item_id },
  );
}

function humanizeToken(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
