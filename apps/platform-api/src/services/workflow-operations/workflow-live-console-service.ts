import type { MissionControlHistoryResponse, MissionControlPacket } from './mission-control-types.js';
import {
  buildWorkflowOperationsSnapshotVersion,
  type WorkflowLiveConsoleItem,
  type WorkflowLiveConsolePacket,
} from './workflow-operations-types.js';

interface LegacyHistorySource {
  getHistory(
    tenantId: string,
    input?: { workflowId?: string; limit?: number },
  ): Promise<MissionControlHistoryResponse>;
}

export class WorkflowLiveConsoleService {
  constructor(private readonly historySource: LegacyHistorySource) {}

  async getLiveConsole(
    tenantId: string,
    workflowId: string,
    input: { limit?: number } = {},
  ): Promise<WorkflowLiveConsolePacket> {
    const response = await this.historySource.getHistory(tenantId, {
      workflowId,
      limit: input.limit ?? 50,
    });
    return {
      generated_at: response.version.generatedAt,
      latest_event_id: response.version.latestEventId,
      snapshot_version: buildWorkflowOperationsSnapshotVersion(response.version.latestEventId),
      items: response.packets.map(toLiveConsoleItem),
      next_cursor: null,
    };
  }
}

function toLiveConsoleItem(packet: MissionControlPacket): WorkflowLiveConsoleItem {
  return {
    item_id: packet.id,
    item_kind: packet.category === 'output' ? 'milestone_brief' : 'platform_notice',
    headline: packet.title,
    summary: packet.summary,
    created_at: packet.changedAt,
    linked_target_ids: [packet.workflowId].filter(Boolean),
  };
}
