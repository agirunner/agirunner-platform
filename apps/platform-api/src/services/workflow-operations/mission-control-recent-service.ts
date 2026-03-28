import type { DatabasePool } from '../../db/database.js';
import { EventQueryService } from '../event-query-service.js';
import { buildMissionControlPacket, buildWorkflowMap, groupWorkflowIds } from './mission-control-packet-support.js';
import type { MissionControlRecentResponse, MissionControlWorkflowCard } from './mission-control-types.js';
import { MissionControlLiveService } from './mission-control-live-service.js';

export class MissionControlRecentService {
  private readonly eventQueryService: EventQueryService;

  constructor(
    pool: DatabasePool,
    private readonly liveService: MissionControlLiveService,
  ) {
    this.eventQueryService = new EventQueryService(pool);
  }

  async getRecent(
    tenantId: string,
    input: { limit?: number } = {},
  ): Promise<MissionControlRecentResponse> {
    const version = {
      generatedAt: new Date().toISOString(),
      latestEventId: await this.liveService.getLatestEventId(tenantId),
      token: 'mission-control:recent',
    };
    const events = await this.eventQueryService.listEvents({
      tenantId,
      limit: input.limit ?? 50,
    });
    const relevantEvents = events.data.filter((event) => shouldIncludeRecentEvent(event as never));
    const workflows = await this.loadWorkflowCardsForEvents(tenantId, relevantEvents.map((row) => row as never));
    const workflowMap = buildWorkflowMap(workflows);
    return {
      version,
      packets: relevantEvents.map((event) =>
        buildMissionControlPacket(event as never, workflowMap.get(resolveWorkflowId(event))),
      ),
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

function shouldIncludeRecentEvent(event: {
  entity_type: string;
  entity_id: string;
  type: string;
  data: Record<string, unknown> | null;
}): boolean {
  const workflowId = resolveWorkflowId(event);
  if (!workflowId) {
    return false;
  }
  if (event.type.startsWith('workflow.activation.')) {
    return false;
  }

  const reason = readString(event.data?.reason);
  if (reason && INTERNAL_REASON_CODES.has(reason)) {
    return false;
  }

  return hasOperatorReadablePayload(event.data) || isMeaningfulRecentEventType(event.type);
}

const INTERNAL_REASON_CODES = new Set([
  'heartbeat',
  'queued_events',
  'task_started',
]);

function hasOperatorReadablePayload(data: Record<string, unknown> | null): boolean {
  if (!data) {
    return false;
  }
  return (
    readString(data.summary) !== null
    || readString(data.request_summary) !== null
    || readString(data.logical_name) !== null
    || readString(data.logical_path) !== null
  );
}

function isMeaningfulRecentEventType(eventType: string): boolean {
  return [
    'brief',
    'deliverable',
    'document',
    'artifact',
    'output',
    'approve',
    'reject',
    'request_changes',
    'escalat',
    'pause',
    'resume',
    'cancel',
    'retry',
    'skip',
    'reassign',
    'redrive',
    'complete',
    'failed',
    'created',
    'state_changed',
    'input_packet',
    'intervention',
  ].some((fragment) => eventType.includes(fragment));
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
