import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';

import { subscribeToEvents, type StreamEventPayload } from '../../lib/sse.js';

interface MissionControlQueryInput {
  scope: string;
  savedView: string;
  workflowId?: string | null;
}

const REALTIME_ENTITY_TYPES = new Set([
  'workflow',
  'workflow_work_item',
  'work_item',
  'task',
  'workflow_document',
  'workflow_artifact',
]);

export function buildMissionControlLiveQueryKey(input: Omit<MissionControlQueryInput, 'workflowId'>) {
  return ['mission-control', 'live', input.scope, input.savedView] as const;
}

export function buildMissionControlRecentQueryKey(
  input: Omit<MissionControlQueryInput, 'workflowId'>,
) {
  return ['mission-control', 'recent', input.scope, input.savedView] as const;
}

export function buildMissionControlHistoryQueryKey(input: MissionControlQueryInput) {
  return ['mission-control', 'history', input.scope, input.savedView, input.workflowId ?? 'all'] as const;
}

export function buildMissionControlWorkspaceQueryKey(workflowId: string) {
  return ['mission-control', 'workspace', workflowId] as const;
}

export function shouldInvalidateMissionControlRealtimeEvent(
  eventType: string,
  payload: StreamEventPayload,
): boolean {
  if (
    eventType.startsWith('workflow.')
    || eventType.startsWith('work_item.')
    || eventType.startsWith('task.')
    || eventType.startsWith('workflow_document.')
    || eventType.startsWith('workflow_artifact.')
  ) {
    return true;
  }

  return typeof payload.entity_type === 'string' && REALTIME_ENTITY_TYPES.has(payload.entity_type);
}

export function useMissionControlRealtime(queryClient: QueryClient): void {
  useEffect(() => {
    return subscribeToEvents(
      (eventType, payload) => {
        if (!shouldInvalidateMissionControlRealtimeEvent(eventType, payload)) {
          return;
        }
        void queryClient.invalidateQueries({ queryKey: ['mission-control'] });
      },
      {
        eventTypePrefixes: [
          'workflow.',
          'work_item.',
          'task.',
          'workflow_document.',
          'workflow_artifact.',
        ],
      },
    );
  }, [queryClient]);
}
