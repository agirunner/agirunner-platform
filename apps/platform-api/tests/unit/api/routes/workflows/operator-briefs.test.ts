import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkflowRoutesApp,
  resetWorkflowRouteAuthMocks,
  workflowRoutes,
} from './support.js';

describe('workflow routes operator briefs', () => {
  let app: ReturnType<typeof createWorkflowRoutesApp> | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    resetWorkflowRouteAuthMocks();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    vi.clearAllMocks();
  });

  it('lists workflow input packets through workflow-owned routes', async () => {
    const listWorkflowInputPackets = vi.fn().mockResolvedValue([
      {
        id: 'packet-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        packet_kind: 'supplemental',
        source: 'operator',
        summary: 'Added a deployment checklist',
        structured_inputs: { environment: 'staging' },
        metadata: {},
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
        files: [],
      },
    ]);

    app = createWorkflowRoutesApp({
      workflowInputPacketService: { listWorkflowInputPackets },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/input-packets',
      headers: { authorization: 'Bearer test' },
    });

    expect(response.statusCode).toBe(200);
    expect(listWorkflowInputPackets).toHaveBeenCalledWith('tenant-1', 'workflow-1');
    expect(response.json().data[0]).toEqual(
      expect.objectContaining({
        id: 'packet-1',
        packet_kind: 'supplemental',
      }),
    );
  });

  it('records workflow interventions with attachments through workflow-owned routes', async () => {
    const recordIntervention = vi.fn().mockResolvedValue({
      id: 'intervention-1',
      workflow_id: 'workflow-1',
      work_item_id: '00000000-0000-0000-0000-000000000201',
      task_id: '00000000-0000-0000-0000-000000000301',
      kind: 'task_action',
      origin: 'operator',
      status: 'applied',
      summary: 'Retry the failed verification task',
      note: 'Use the attached checklist first.',
      structured_action: { kind: 'retry_task', task_id: 'task-1' },
      metadata: {},
      created_by_type: 'user',
      created_by_id: 'user-1',
      created_at: '2026-03-27T10:05:00.000Z',
      updated_at: '2026-03-27T10:05:00.000Z',
      files: [],
    });

    app = createWorkflowRoutesApp({
      workflowInterventionService: { recordIntervention },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/interventions',
      headers: { authorization: 'Bearer test' },
      payload: {
        kind: 'task_action',
        summary: 'Retry the failed verification task',
        note: 'Use the attached checklist first.',
        work_item_id: '00000000-0000-0000-0000-000000000201',
        task_id: '00000000-0000-0000-0000-000000000301',
        structured_action: { kind: 'retry_task', task_id: '00000000-0000-0000-0000-000000000301' },
        files: [
          {
            file_name: 'checklist.txt',
            content_base64: Buffer.from('checklist').toString('base64'),
            content_type: 'text/plain',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        kind: 'task_action',
        workItemId: '00000000-0000-0000-0000-000000000201',
        taskId: '00000000-0000-0000-0000-000000000301',
      }),
    );
  });

  it('lists and records workflow operator briefs through workflow-owned routes', async () => {
    const listBriefs = vi.fn().mockResolvedValue([
      {
        id: 'brief-1',
        workflow_id: 'workflow-1',
        work_item_id: null,
        task_id: null,
        request_id: 'request-1',
        execution_context_id: 'execution-1',
        brief_kind: 'milestone',
        brief_scope: 'workflow_timeline',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        status_kind: 'in_progress',
        short_brief: { headline: 'Release package is ready for approval.' },
        detailed_brief_json: { headline: 'Release package is ready for approval.' },
        sequence_number: 4,
        related_artifact_ids: [],
        related_output_descriptor_ids: [],
        related_intervention_ids: [],
        canonical_workflow_brief_id: null,
        created_by_type: 'user',
        created_by_id: 'user-1',
        created_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
      },
    ]);
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-2',
      sequence_number: 5,
      deduped: false,
      record: {
        id: 'brief-2',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Verification completed.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs,
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const headers = { authorization: 'Bearer test' };
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/workflow-1/operator-briefs?limit=10',
      headers,
    });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers,
      payload: {
        request_id: 'request-2',
        execution_context_id: 'execution-2',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'workflow_timeline',
        source_kind: 'orchestrator',
        source_role_name: 'Orchestrator',
        status_kind: 'in_progress',
        payload: {
          short_brief: {
            headline: 'Verification completed.',
          },
          detailed_brief_json: {
            headline: 'Verification completed.',
            status_kind: 'in_progress',
          },
          linked_deliverables: [
            {
              descriptor_kind: 'artifact',
              delivery_stage: 'final',
              title: 'Release bundle',
              state: 'final',
              primary_target: {
                target_kind: 'artifact',
                label: 'Download release bundle',
                url: 'https://example.invalid/bundle.zip',
              },
            },
          ],
          linked_target_ids: ['target-1'],
        },
      },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(listBriefs).toHaveBeenCalledWith('tenant-1', 'workflow-1', {
      workItemId: undefined,
      limit: 10,
    });
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-2',
        executionContextId: 'execution-2',
        briefKind: 'milestone',
        payload: expect.objectContaining({
          linkedTargetIds: ['target-1'],
        }),
      }),
    );
  });

  it('accepts operator brief route writes without a duplicate top-level status_kind field', async () => {
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-3',
      sequence_number: 6,
      deduped: false,
      record: {
        id: 'brief-3',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Verification completed.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-3',
        execution_context_id: 'execution-3',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'workflow_timeline',
        source_kind: 'orchestrator',
        payload: {
          short_brief: {
            headline: 'Verification completed.',
          },
          detailed_brief_json: {
            headline: 'Verification completed.',
            status_kind: 'in_progress',
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-3',
        executionContextId: 'execution-3',
        statusKind: undefined,
      }),
    );
  });

  it('accepts shorthand linked deliverables with label and path on operator brief writes', async () => {
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-4',
      sequence_number: 7,
      deduped: false,
      record: {
        id: 'brief-4',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Release readiness is complete.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-4',
        execution_context_id: 'execution-4',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'orchestrator',
        payload: {
          short_brief: {
            headline: 'Release readiness is complete.',
          },
          detailed_brief_json: {
            headline: 'Release readiness is complete.',
            status_kind: 'completed',
          },
          linked_deliverables: [
            {
              label: 'Release-readiness record',
              path: 'docs/release-audit-release-readiness.md',
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-4',
        payload: expect.objectContaining({
          linkedDeliverables: [
            expect.objectContaining({
              descriptorKind: 'deliverable_packet',
              deliveryStage: 'final',
              title: 'Release-readiness record',
              state: 'final',
              previewCapabilities: expect.objectContaining({
                can_inline_preview: true,
                can_copy_path: true,
              }),
              primaryTarget: expect.objectContaining({
                target_kind: 'inline_summary',
                label: 'Release-readiness record',
                path: 'docs/release-audit-release-readiness.md',
              }),
              contentPreview: expect.objectContaining({
                summary: expect.stringContaining('docs/release-audit-release-readiness.md'),
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('maps shorthand linked deliverables to interim packets when the source brief is still in progress', async () => {
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-4b',
      sequence_number: 8,
      deduped: false,
      record: {
        id: 'brief-4b',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Release readiness is being reviewed.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-4b',
        execution_context_id: 'execution-4b',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'orchestrator',
        status_kind: 'in_progress',
        payload: {
          short_brief: {
            headline: 'Release readiness is being reviewed.',
          },
          detailed_brief_json: {
            headline: 'Release readiness is being reviewed.',
            status_kind: 'in_progress',
          },
          linked_deliverables: [
            {
              label: 'Release-readiness record',
              path: 'docs/release-audit-release-readiness.md',
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-4b',
        payload: expect.objectContaining({
          linkedDeliverables: [
            expect.objectContaining({
              descriptorKind: 'deliverable_packet',
              deliveryStage: 'in_progress',
              title: 'Release-readiness record',
              state: 'draft',
            }),
          ],
        }),
      }),
    );
  });

  it('normalizes shorthand internal linked deliverable paths before brief persistence', async () => {
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-4c',
      sequence_number: 9,
      deduped: false,
      record: {
        id: 'brief-4c',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Seeded the first work item and starter task.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-4c',
        execution_context_id: 'execution-4c',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'orchestrator',
        payload: {
          short_brief: {
            headline: 'Seeded the first work item and starter task.',
          },
          detailed_brief_json: {
            headline: 'Seeded the first work item and starter task.',
            status_kind: 'in_progress',
          },
          linked_deliverables: [
            {
              label: 'Research Analyst starter task',
              path: 'task 00000000-0000-0000-0000-000000000301',
            },
            {
              label: 'Question-framing work item',
              path: 'work item 00000000-0000-0000-0000-000000000201',
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: 'request-4c',
        payload: expect.objectContaining({
          linkedDeliverables: [
            expect.objectContaining({
              primaryTarget: expect.objectContaining({
                path: 'task:00000000-0000-0000-0000-000000000301',
              }),
            }),
            expect.objectContaining({
              primaryTarget: expect.objectContaining({
                path: 'work_item:00000000-0000-0000-0000-000000000201',
              }),
            }),
          ],
        }),
      }),
    );
  });

  it('returns recoverable guidance when shorthand linked deliverables omit label or path', async () => {
    const recordBriefWrite = vi.fn();

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        request_id: 'request-5',
        execution_context_id: 'execution-5',
        workflow_id: 'workflow-1',
        brief_kind: 'milestone',
        brief_scope: 'deliverable_context',
        source_kind: 'specialist',
        payload: {
          short_brief: {
            headline: 'Advisory patch plan created for audit export hang.',
          },
          detailed_brief_json: {
            headline: 'Advisory patch plan created for audit export hang.',
            status_kind: 'completed',
          },
          linked_deliverables: [
            {
              path: 'docs/patch-plan.md',
            },
          ],
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(response.json().error.recovery_hint).toBe('resubmit_operator_brief_with_deliverable_label');
    expect(response.json().error.message).toContain('linked_deliverables');
    expect(response.json().error.message).toContain('label and path');
    expect(response.json().error.details.reason_code).toBe(
      'record_operator_brief_invalid_linked_deliverable_shorthand',
    );
    expect(response.json().error.details.recoverable).toBe(true);
    expect(response.json().error.details.safetynet_behavior_id).toBe(
      'platform.operator_brief.schema_guidance',
    );
    expect(response.json().error.details.invalid_fields).toEqual(['payload.linked_deliverables']);
    expect(recordBriefWrite).not.toHaveBeenCalled();
  });

  it('accepts operator brief route writes when runtime-derived fields are omitted', async () => {
    const recordBriefWrite = vi.fn().mockResolvedValue({
      record_id: 'brief-4',
      sequence_number: 7,
      deduped: false,
      record: {
        id: 'brief-4',
        workflow_id: 'workflow-1',
        short_brief: { headline: 'Verification completed.' },
      },
    });

    app = createWorkflowRoutesApp({
      workflowOperatorBriefService: {
        listBriefs: vi.fn().mockResolvedValue([]),
        recordBriefWrite,
      },
    });
    await app.register(workflowRoutes);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/workflow-1/operator-briefs',
      headers: { authorization: 'Bearer test' },
      payload: {
        execution_context_id: 'execution-4',
        workflow_id: 'workflow-1',
        payload: {
          short_brief: {
            headline: 'Verification completed.',
          },
          detailed_brief_json: {
            headline: 'Verification completed.',
            status_kind: 'in_progress',
          },
        },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(recordBriefWrite).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
      'workflow-1',
      expect.objectContaining({
        requestId: undefined,
        executionContextId: 'execution-4',
        briefKind: undefined,
        briefScope: undefined,
        sourceKind: undefined,
      }),
    );
  });
});
