import { vi } from 'vitest';

import { WorkflowOperatorBriefService } from '../../../../src/services/workflow-operator/workflow-operator-brief-service.js';
import type { WorkflowOperatorBriefRow } from '../../../../src/services/workflow-operator/workflow-operator-brief-service.types.js';

export const IDENTITY = {
  id: 'key-1',
  tenantId: 'tenant-1',
  scope: 'admin',
  ownerType: 'user',
  ownerId: 'user-1',
  keyPrefix: 'admin',
} as const;

export function createPool() {
  return {
    query: vi.fn(),
  };
}

export function createWorkflowOperatorBriefServiceTestContext() {
  const pool = createPool();
  const deliverableService = {
    upsertDeliverable: vi.fn(),
  };
  const service = new WorkflowOperatorBriefService(pool as never, deliverableService as never);
  return {
    pool,
    deliverableService,
    service,
  };
}

export function createWorkflowOperatorBriefRow(
  overrides: Partial<WorkflowOperatorBriefRow> = {},
): WorkflowOperatorBriefRow {
  const timestamp = new Date('2026-03-27T00:00:00.000Z');
  return {
    id: 'brief-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    work_item_id: null,
    task_id: null,
    request_id: 'request-1',
    execution_context_id: 'execution-1',
    brief_kind: 'milestone',
    brief_scope: 'workflow_timeline',
    source_kind: 'specialist',
    source_role_name: 'Verifier',
    llm_turn_count: null,
    status_kind: 'in_progress',
    short_brief: { headline: 'Brief headline' },
    detailed_brief_json: { headline: 'Brief headline', status_kind: 'in_progress' },
    linked_target_ids: [],
    sequence_number: 1,
    related_artifact_ids: [],
    related_output_descriptor_ids: [],
    related_intervention_ids: [],
    canonical_workflow_brief_id: null,
    created_by_type: 'user',
    created_by_id: 'user-1',
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  };
}
