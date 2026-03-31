import type { StreamEvent } from '../../event/event-stream-service.js';
import type {
  MissionControlOutputDescriptor,
  MissionControlPacket,
  MissionControlPacketCategory,
  MissionControlWorkflowCard,
} from './types.js';

export function buildMissionControlPacket(
  event: StreamEvent,
  workflow?: MissionControlWorkflowCard,
): MissionControlPacket {
  const workflowId = readWorkflowId(event);
  const title = humanizeEventType(event.type);
  const summary = readEventSummary(event, workflow, title);
  return {
    id: `event:${event.id}`,
    workflowId,
    workflowName: workflow?.name ?? null,
    posture: workflow?.posture ?? null,
    category: classifyPacketCategory(event.type),
    title,
    summary,
    changedAt: event.created_at,
    carryover: Boolean(
      workflow
      && ['needs_decision', 'needs_intervention', 'recoverable_needs_steering', 'terminal_failed'].includes(workflow.posture),
    ),
    outputDescriptors: workflow?.outputDescriptors ?? [],
  };
}

export function filterPacketsByCategories(
  packets: MissionControlPacket[],
  categories: MissionControlPacketCategory[],
): MissionControlPacket[] {
  const allowed = new Set(categories);
  return packets.filter((packet) => allowed.has(packet.category));
}

export function groupWorkflowIds(events: StreamEvent[]): string[] {
  return Array.from(new Set(events.map((event) => readWorkflowId(event)).filter(Boolean)));
}

function classifyPacketCategory(eventType: string): MissionControlPacketCategory {
  if (matchesAny(eventType, ['approve', 'reject', 'request_changes'])) return 'decision';
  if (matchesAny(eventType, ['escalat', 'pause', 'resume', 'cancel', 'retry', 'skip', 'reassign', 'redrive'])) {
    return 'intervention';
  }
  if (matchesAny(eventType, ['artifact', 'document', 'output', 'complete'])) return 'output';
  if (matchesAny(eventType, ['activation', 'state_changed', 'created'])) return 'progress';
  return 'system';
}

function humanizeEventType(eventType: string): string {
  return eventType
    .split(/[._]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function readEventSummary(
  event: StreamEvent,
  workflow: MissionControlWorkflowCard | undefined,
  genericTitle: string,
): string {
  const summary = readString(event.data.summary);
  if (summary) return summary;
  const requestSummary = readString(event.data.request_summary);
  if (requestSummary) return requestSummary;
  const reason = readString(event.data.reason);
  if (reason) return `Reason: ${reason}`;
  const logicalName = readString(event.data.logical_name);
  if (logicalName) return `Updated ${logicalName}`;
  const artifactPath = readString(event.data.logical_path);
  if (artifactPath) return `Updated ${artifactPath}`;
  return workflow?.pulse.summary ?? genericTitle;
}

function readWorkflowId(event: StreamEvent): string {
  const dataWorkflowId = readString(event.data.workflow_id);
  if (dataWorkflowId) return dataWorkflowId;
  return event.entity_type === 'workflow' ? event.entity_id : '';
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function matchesAny(eventType: string, fragments: string[]): boolean {
  return fragments.some((fragment) => eventType.includes(fragment));
}

export function buildWorkflowMap(
  workflows: MissionControlWorkflowCard[],
): Map<string, MissionControlWorkflowCard> {
  return new Map(workflows.map((workflow) => [workflow.id, workflow]));
}

export function readLatestOutput(
  workflow?: MissionControlWorkflowCard,
): MissionControlOutputDescriptor[] {
  return workflow?.outputDescriptors ?? [];
}
