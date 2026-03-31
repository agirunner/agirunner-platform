import type { DatabasePool } from '../../../db/database.js';
import { EventQueryService } from '../../event/event-query-service.js';
import { buildMissionControlPacket, buildWorkflowMap, groupWorkflowIds } from './packet-support.js';
import type { MissionControlHistoryResponse, MissionControlWorkflowCard } from './types.js';
import { MissionControlLiveService } from './live-service.js';

export class MissionControlHistoryService {
  private readonly eventQueryService: EventQueryService;

  constructor(
    pool: DatabasePool,
    private readonly liveService: MissionControlLiveService,
  ) {
    this.eventQueryService = new EventQueryService(pool);
  }

  async getHistory(
    tenantId: string,
    input: { workflowId?: string; limit?: number } = {},
  ): Promise<MissionControlHistoryResponse> {
    const version = {
      generatedAt: new Date().toISOString(),
      latestEventId: await this.liveService.getLatestEventId(tenantId),
      token: 'mission-control:history',
    };
    const events = await this.eventQueryService.listEvents({
      tenantId,
      workflowScopeId: input.workflowId,
      limit: input.limit ?? 100,
    });
    const workflows = await this.loadWorkflowCardsForEvents(tenantId, events.data.map((row) => row as never));
    const workflowMap = buildWorkflowMap(workflows);
    return {
      version,
      packets: events.data.map((event) => buildMissionControlPacket(event as never, workflowMap.get(resolveWorkflowId(event)))),
    };
  }

  private async loadWorkflowCardsForEvents(
    tenantId: string,
    events: Array<{ entity_type: string; entity_id: string; data: Record<string, unknown> | null }>,
  ): Promise<MissionControlWorkflowCard[]> {
    const workflowIds = groupWorkflowIds(events as never);
    return this.liveService.listWorkflowCards(tenantId, { workflowIds });
  }
}

function resolveWorkflowId(event: { entity_type: string; entity_id: string; data: Record<string, unknown> | null }): string {
  const data = event.data ?? {};
  return typeof data.workflow_id === 'string'
    ? data.workflow_id
    : event.entity_type === 'workflow'
      ? event.entity_id
      : '';
}
