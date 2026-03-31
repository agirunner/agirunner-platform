import { vi } from 'vitest';

import { WorkflowTaskDeliverablePromotionService } from '../../../src/services/workflow-task-deliverable-promotion-service.js';

export function createDeliverableService() {
  return {
    upsertSystemDeliverable: vi.fn(async (tenantId: string, workflowId: string, input: Record<string, unknown>) => ({
      tenantId,
      workflowId,
      input,
      descriptor_id: (input as { descriptorId?: string }).descriptorId ?? 'descriptor-1',
    })),
  };
}

export function createService(
  pool: { query: ReturnType<typeof vi.fn> },
  deliverableService = createDeliverableService(),
) {
  return new WorkflowTaskDeliverablePromotionService(pool as never, deliverableService as never);
}

export function createWorkItemRow(title: string) {
  return {
    title,
  };
}

export function createDescriptorRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'descriptor-1',
    delivery_stage: 'draft',
    state: 'draft',
    ...overrides,
  };
}

export function createArtifactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'artifact-1',
    task_id: 'task-2',
    logical_path: 'artifact:workflow/output/workflows-intake-02-triage-packet.md',
    content_type: 'text/markdown',
    ...overrides,
  };
}
