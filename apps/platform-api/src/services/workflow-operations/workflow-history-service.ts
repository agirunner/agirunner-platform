import type { MissionControlHistoryResponse, MissionControlPacket } from './mission-control-types.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowHistoryGroup,
  type WorkflowHistoryItem,
  type WorkflowHistoryPacket,
} from './workflow-operations-types.js';

interface LegacyHistorySource {
  getHistory(
    tenantId: string,
    input?: { workflowId?: string; limit?: number },
  ): Promise<MissionControlHistoryResponse>;
}

export class WorkflowHistoryService {
  constructor(private readonly historySource: LegacyHistorySource) {}

  async getHistory(
    tenantId: string,
    workflowId: string,
    input: { limit?: number } = {},
  ): Promise<WorkflowHistoryPacket & { legacy_packets: MissionControlPacket[] }> {
    const response = await this.historySource.getHistory(tenantId, {
      workflowId,
      limit: input.limit ?? 100,
    });
    const items = response.packets.map(toHistoryItem);
    return {
      generated_at: response.version.generatedAt,
      latest_event_id: response.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(response.version.latestEventId),
      groups: buildGroups(items),
      items,
      filters: {
        available: ['briefs', 'interventions', 'inputs', 'deliverables', 'redrives'],
        active: [],
      },
      next_cursor: null,
      legacy_packets: response.packets,
    };
  }
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

function toHistoryItem(packet: MissionControlPacket): WorkflowHistoryItem {
  return {
    item_id: packet.id,
    item_kind: mapCategoryToItemKind(packet.category),
    headline: packet.title,
    summary: packet.summary,
    created_at: packet.changedAt,
    linked_target_ids: [packet.workflowId].filter(Boolean),
  };
}

function mapCategoryToItemKind(category: MissionControlPacket['category']): WorkflowHistoryItem['item_kind'] {
  if (category === 'output') {
    return 'deliverable';
  }
  if (category === 'decision' || category === 'intervention') {
    return 'intervention';
  }
  return 'milestone_brief';
}
