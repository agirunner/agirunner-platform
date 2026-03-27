import type { MissionControlHistoryResponse } from './mission-control-types.js';
import type { WorkflowDeliverableRecord } from '../workflow-deliverable-service.js';
import type { WorkflowInputPacketRecord } from '../workflow-input-packet-service.js';
import type { WorkflowInterventionRecord } from '../workflow-intervention-service.js';
import type { WorkflowOperatorBriefRecord } from '../workflow-operator-brief-service.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowHistoryGroup,
  type WorkflowHistoryItem,
  type WorkflowHistoryPacket,
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
  ): Promise<WorkflowDeliverableRecord[]>;
}

export class WorkflowHistoryService {
  constructor(
    private readonly versionSource: VersionSource,
    private readonly briefSource: BriefSource,
    private readonly interventionSource: InterventionSource,
    private readonly inputPacketSource: InputPacketSource,
    private readonly deliverableSource: DeliverableSource,
  ) {}

  async getHistory(
    tenantId: string,
    workflowId: string,
    input: { limit?: number; workItemId?: string } = {},
  ): Promise<WorkflowHistoryPacket> {
    const limit = input.limit ?? 100;
    const [version, briefs, interventions, inputPackets, deliverables] = await Promise.all([
      this.versionSource.getHistory(tenantId, {
        workflowId,
        limit: 1,
      }),
      this.briefSource.listBriefs(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
      this.interventionSource.listWorkflowInterventions(tenantId, workflowId),
      this.inputPacketSource.listWorkflowInputPackets(tenantId, workflowId),
      this.deliverableSource.listDeliverables(tenantId, workflowId, {
        workItemId: input.workItemId,
        limit,
      }),
    ]);

    const items = [
      ...briefs.map(toBriefHistoryItem),
      ...filterByWorkItem(interventions, input.workItemId).map(toInterventionHistoryItem),
      ...filterInputPackets(inputPackets, input.workItemId).map(toInputHistoryItem),
      ...deliverables.map(toDeliverableHistoryItem),
    ]
      .sort(sortNewestFirst)
      .slice(0, limit);

    return {
      generated_at: version.version.generatedAt,
      latest_event_id: version.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(version.version.latestEventId),
      groups: buildGroups(items),
      items,
      filters: {
        available: ['briefs', 'interventions', 'inputs', 'deliverables', 'redrives'],
        active: [],
      },
      next_cursor: null,
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
    headline: readRequiredString(intervention.summary, 'Workflow intervention'),
    summary: readOptionalString(intervention.note) ?? readRequiredString(intervention.summary, 'Workflow intervention'),
    created_at: intervention.created_at,
    linked_target_ids: buildLinkedTargetIds(intervention),
  };
}

function toInputHistoryItem(packet: WorkflowInputPacketRecord): WorkflowHistoryItem {
  const packetKind = readOptionalString(packet.packet_kind);
  return {
    item_id: packet.id,
    item_kind: packetKind === 'redrive' ? 'redrive' : 'input',
    headline: readOptionalString(packet.summary) ?? humanizePacketKind(packetKind),
    summary: readOptionalString(packet.summary) ?? humanizePacketKind(packetKind),
    created_at: packet.created_at,
    linked_target_ids: buildLinkedTargetIds(packet),
  };
}

function toDeliverableHistoryItem(deliverable: WorkflowDeliverableRecord): WorkflowHistoryItem {
  return {
    item_id: deliverable.descriptor_id,
    item_kind: 'deliverable',
    headline: readRequiredString(deliverable.title, 'Workflow deliverable'),
    summary: readOptionalString(deliverable.summary_brief) ?? readRequiredString(deliverable.title, 'Workflow deliverable'),
    created_at: deliverable.updated_at ?? deliverable.created_at,
    linked_target_ids: buildLinkedTargetIds(deliverable),
  };
}

function buildLinkedTargetIds(
  record:
    | WorkflowOperatorBriefRecord
    | WorkflowInterventionRecord
    | WorkflowInputPacketRecord
    | WorkflowDeliverableRecord,
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
  return packetKind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sortNewestFirst(left: WorkflowHistoryItem, right: WorkflowHistoryItem): number {
  return right.created_at.localeCompare(left.created_at);
}
