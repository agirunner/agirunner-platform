import type {
  MissionControlActionAvailability,
  MissionControlWorkflowCard,
} from '../mission-control-types.js';
import { isWorkflowScopeHeaderAction } from '../mission-control-action-availability.js';
import type {
  WorkflowInterventionRecord,
} from '../../workflow-intervention-service.js';
import type {
  WorkflowSteeringMessageRecord,
  WorkflowSteeringSessionRecord,
} from '../../workflow-steering-session-service/workflow-steering-session-service.js';
import type {
  WorkflowLiveConsoleItem,
  WorkflowWorkspacePacket,
} from '../workflow-operations-types.js';
import { buildWorkflowLiveConsoleCounts } from '../workflow-live-console-counts.js';
import {
  humanizeActionKind,
  readOptionalString,
} from './workflow-workspace-common.js';

export function selectSteeringSessionForSelectedScope(
  sessions: WorkflowSteeringSessionRecord[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowSteeringSessionRecord | null {
  if (selectedScope.scope_kind === 'workflow') {
    return sessions.find((session) => (session.work_item_id ?? null) === null) ?? null;
  }
  const scopedWorkItemId = selectedScope.work_item_id;
  if (!scopedWorkItemId) {
    return null;
  }
  return sessions.find((session) => (session.work_item_id ?? null) === scopedWorkItemId) ?? null;
}

export function selectSteeringSessionsForSelectedScope(
  sessions: WorkflowSteeringSessionRecord[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowSteeringSessionRecord[] {
  if (selectedScope.scope_kind === 'workflow') {
    return sessions;
  }
  const scopedWorkItemId = selectedScope.work_item_id;
  if (!scopedWorkItemId) {
    return [];
  }
  return sessions.filter((session) => (session.work_item_id ?? null) === scopedWorkItemId);
}

export function filterSteeringInterventionsForSelectedScope(
  interventions: WorkflowInterventionRecord[],
  selectedScope: WorkflowWorkspacePacket['selected_scope'],
): WorkflowInterventionRecord[] {
  if (selectedScope.scope_kind === 'workflow') {
    return interventions.filter((intervention) => intervention.work_item_id === null && intervention.task_id === null);
  }
  if (selectedScope.scope_kind === 'selected_task') {
    return interventions.filter((intervention) => intervention.task_id === selectedScope.task_id);
  }
  return interventions.filter((intervention) =>
    intervention.work_item_id === selectedScope.work_item_id && intervention.task_id === null,
  );
}

export function canAcceptWorkflowSteering(workflowCard: MissionControlWorkflowCard | null): boolean {
  if (!workflowCard) {
    return false;
  }
  const state = (workflowCard.state || workflowCard.posture || '').trim().toLowerCase();
  if (state.length === 0) {
    return true;
  }
  return state !== 'paused' && state !== 'completed' && state !== 'cancelled';
}

export function filterSteeringQuickActions(
  actions: MissionControlActionAvailability[],
): MissionControlActionAvailability[] {
  return actions.filter((action) => !isWorkflowScopeHeaderAction(action.kind));
}

export function mergeSteeringMessagesIntoLiveConsole(
  packet: WorkflowWorkspacePacket['live_console'],
  messages: WorkflowSteeringMessageRecord[],
): WorkflowWorkspacePacket['live_console'] {
  const steeringItems = messages
    .map(toSteeringLiveConsoleItem)
    .filter((item): item is WorkflowLiveConsoleItem => item !== null);
  if (steeringItems.length === 0) {
    return packet;
  }

  const existingIds = new Set(packet.items.map((item) => item.item_id));
  const newSteeringItems = steeringItems.filter((item) => !existingIds.has(item.item_id));
  if (newSteeringItems.length === 0) {
    return packet;
  }

  const mergedItems = [...packet.items, ...newSteeringItems].sort(sortNewestLiveConsoleFirst);
  const mergedCounts = buildMergedLiveConsoleCounts(packet, newSteeringItems.length, mergedItems);

  return {
    ...packet,
    items: mergedItems,
    total_count: mergedCounts.all,
    counts: mergedCounts,
  };
}

export function readSessionStatus(session: WorkflowSteeringSessionRecord | null): string {
  if (!session) {
    return 'idle';
  }
  return session.status.trim().length > 0 ? session.status : 'open';
}

function toSteeringLiveConsoleItem(
  message: WorkflowSteeringMessageRecord,
): WorkflowLiveConsoleItem | null {
  const headline = readOptionalString(message.headline) ?? readOptionalString(message.body);
  if (!headline) {
    return null;
  }

  const summary = readOptionalString(message.body) ?? headline;
  const linkedTargetIds = [
    message.work_item_id,
    message.linked_intervention_id,
    message.linked_input_packet_id,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    item_id: message.id,
    item_kind: 'steering_message',
    source_kind: message.source_kind,
    source_label: readSteeringSourceLabel(message.source_kind),
    headline,
    summary,
    created_at: message.created_at,
    work_item_id: message.work_item_id ?? null,
    task_id: null,
    linked_target_ids: linkedTargetIds,
    scope_binding: 'record',
  };
}

function readSteeringSourceLabel(sourceKind: string): string {
  switch (sourceKind) {
    case 'operator':
      return 'Operator';
    case 'platform':
      return 'Orchestrator';
    case 'system':
      return 'System';
    default:
      return humanizeActionKind(sourceKind);
  }
}

function buildMergedLiveConsoleCounts(
  packet: WorkflowWorkspacePacket['live_console'],
  addedSteeringCount: number,
  mergedItems: WorkflowLiveConsoleItem[],
): WorkflowWorkspacePacket['live_console']['counts'] {
  const existingCounts = packet.counts;
  if (!existingCounts) {
    return buildWorkflowLiveConsoleCounts(mergedItems);
  }
  return {
    all: existingCounts.all + addedSteeringCount,
    turn_updates: existingCounts.turn_updates,
    briefs: existingCounts.briefs,
    steering: (existingCounts.steering ?? 0) + addedSteeringCount,
  };
}

function sortNewestLiveConsoleFirst(left: WorkflowLiveConsoleItem, right: WorkflowLiveConsoleItem): number {
  const rightTimestamp = readOptionalString(right.created_at) ?? '';
  const leftTimestamp = readOptionalString(left.created_at) ?? '';
  return rightTimestamp.localeCompare(leftTimestamp) || right.item_id.localeCompare(left.item_id);
}
