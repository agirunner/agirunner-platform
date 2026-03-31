import { vi } from 'vitest';

import { WorkflowHistoryService } from '../../../../src/services/workflow-operations/workflow-history-service.js';

export function createVersionSource() {
  return {
    getHistory: vi.fn(async () => ({
      version: {
        generatedAt: '2026-03-27T22:40:00.000Z',
        latestEventId: 110,
        token: 'mission-control:110',
      },
      packets: [],
    })),
  };
}

export function createWorkflowHistoryService(input: {
  versionSource?: ReturnType<typeof createVersionSource>;
  briefService?: { listBriefs: ReturnType<typeof vi.fn> };
  updateService?: { listUpdates: ReturnType<typeof vi.fn> };
  interventionService?: { listWorkflowInterventions: ReturnType<typeof vi.fn> };
  inputPacketService?: { listWorkflowInputPackets: ReturnType<typeof vi.fn> };
} = {}) {
  const versionSource = input.versionSource ?? createVersionSource();
  const briefService =
    input.briefService ?? { listBriefs: vi.fn(async () => []) };
  const updateService =
    input.updateService ?? { listUpdates: vi.fn(async () => []) };
  const interventionService =
    input.interventionService ?? { listWorkflowInterventions: vi.fn(async () => []) };
  const inputPacketService =
    input.inputPacketService ?? { listWorkflowInputPackets: vi.fn(async () => []) };

  return {
    service: new WorkflowHistoryService(
      versionSource as never,
      briefService as never,
      updateService as never,
      interventionService as never,
      inputPacketService as never,
    ),
    versionSource,
    briefService,
    updateService,
    interventionService,
    inputPacketService,
  };
}
