import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../src/errors/domain-errors.js';
import { WorkItemService } from '../../src/services/work-item-service.js';

describe('WorkItemService', () => {
  it('rejects seeding the first planned stage work item with a successor-only role', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'briefing',
                lifecycle: 'planned',
                definition: {
                  roles: ['market-researcher', 'managing-editor'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    {
                      name: 'briefing',
                      goal: 'Produce the publication brief',
                      involves: ['market-researcher', 'managing-editor'],
                    },
                  ],
                  handoff_rules: [
                    {
                      from_role: 'market-researcher',
                      to_role: 'managing-editor',
                      required: true,
                    },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT COUNT(*)::int AS count') && sql.includes('FROM workflow_work_items')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'briefing']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('first stage work item insert should not run for a successor-only role');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-briefing-seed-1',
          stage_name: 'briefing',
          title: 'Publish-ready brief from research memo',
          owner_role: 'managing-editor',
        },
      ),
    ).rejects.toThrow(
      "Cannot seed planned stage 'briefing' with role 'managing-editor' before the required upstream handoff exists. Start with one of: market-researcher.",
    );
  });

  it('rejects planned successor work-item creation while the predecessor still has a pending task', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'requirements',
                lifecycle: 'planned',
                definition: {
                  roles: ['product-manager', 'architect'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'requirements', goal: 'Define scope' },
                    { name: 'design', goal: 'Design the solution' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return {
            rows: [
              {
                id: 'wi-req-1',
                title: 'Requirements checkpoint',
                stage_name: 'requirements',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return { rows: [{ count: 1 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run while predecessor task is pending');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-next-1',
          parent_work_item_id: 'wi-req-1',
          stage_name: 'design',
          title: 'Design checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('rejects planned successor work-item creation until the predecessor has a full handoff', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'requirements',
                lifecycle: 'planned',
                definition: {
                  roles: ['product-manager', 'architect'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'requirements', goal: 'Define scope' },
                    { name: 'design', goal: 'Design the solution' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return {
            rows: [
              {
                id: 'wi-req-1',
                title: 'Requirements checkpoint',
                stage_name: 'requirements',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: null,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-req-1']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run before a full predecessor handoff exists');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-next-1',
          parent_work_item_id: 'wi-req-1',
          stage_name: 'design',
          title: 'Design checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('rejects planned successor work-item creation when the predecessor full handoff requests changes', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'review',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'qa'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the implementation' },
                    { name: 'verification', goal: 'Verify the change' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-review-1']);
          return {
            rows: [
              {
                id: 'wi-review-1',
                title: 'Review checkpoint',
                stage_name: 'review',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
                latest_handoff_resolution: 'request_changes',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-review-1']);
          return { rows: [{ count: 0 }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('successor work item insert should not run while predecessor handoff requests changes');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-next-1',
          parent_work_item_id: 'wi-review-1',
          stage_name: 'verification',
          title: 'Verification checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('summarizes required assessments against the current subject revision and ignores stale older approvals', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          expect(sql).toContain('latest_delivery.subject_revision AS current_subject_revision');
          expect(sql).toContain('assessment_handoff.role_data->>\'subject_revision\'');
          expect(sql).toContain("COALESCE(NULLIF(assessment_handoff.role_data->>'subject_revision', '')::int, -1) = COALESCE(latest_delivery.subject_revision, -1)");
          expect(sql).toContain('required_assessment_count');
          expect(sql).toContain('approved_assessment_count');
          expect(sql).toContain('blocking_assessment_count');
          expect(sql).toContain('pending_assessment_count');
          expect(sql).toContain('assessment_status');
          return {
            rows: [
              {
                id: 'wi-impl-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'implementation',
                title: 'Implementation checkpoint',
                column_id: 'planned',
                task_count: '1',
                children_count: '0',
                children_completed: '0',
                current_subject_revision: 2,
                required_assessment_count: 1,
                approved_assessment_count: 0,
                blocking_assessment_count: 0,
                pending_assessment_count: 1,
                assessment_status: 'pending',
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const [workItem] = await service.listWorkflowWorkItems('tenant-1', 'workflow-1');

    expect((workItem as Record<string, unknown>).current_subject_revision).toBe(2);
    expect((workItem as Record<string, unknown>).required_assessment_count).toBe(1);
    expect((workItem as Record<string, unknown>).approved_assessment_count).toBe(0);
    expect((workItem as Record<string, unknown>).blocking_assessment_count).toBe(0);
    expect((workItem as Record<string, unknown>).pending_assessment_count).toBe(1);
    expect((workItem as Record<string, unknown>).assessment_status).toBe('pending');
  });

  it('compares nullable delivery subject task ids without coercing uuids to empty strings', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          expect(sql).toContain("COALESCE(assessment_handoff.role_data->>'subject_task_id', '')");
          expect(sql).toContain("COALESCE(latest_delivery.subject_task_id::text, '')");
          expect(sql).not.toContain("COALESCE(latest_delivery.subject_task_id, '')");
          return {
            rows: [
              {
                id: 'wi-blueprint-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'blueprint',
                title: 'Blueprint checkpoint',
                column_id: 'planned',
                task_count: '0',
                children_count: '0',
                children_completed: '0',
                current_subject_revision: null,
                required_assessment_count: 0,
                approved_assessment_count: 0,
                blocking_assessment_count: 0,
                pending_assessment_count: 0,
                assessment_status: null,
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const [workItem] = await service.listWorkflowWorkItems('tenant-1', 'workflow-1');

    expect((workItem as Record<string, unknown>).stage_name).toBe('blueprint');
    expect((workItem as Record<string, unknown>).assessment_status).toBeNull();
  });

  it('allows the immediate review successor when the predecessor output is pending assessment with a full handoff', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'implementation',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'product-manager'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the implementation' },
                    { name: 'release', goal: 'Release the change' },
                  ],
                  assessment_rules: [
                    { subject_role: 'developer', assessed_by: 'reviewer', checkpoint: 'implementation', required: true },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return {
            rows: [
              {
                id: 'wi-impl-1',
                title: 'Implementation checkpoint',
                stage_name: 'implementation',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('GROUP BY state')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return {
            rows: [{ state: 'output_pending_assessment', count: 1 }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes("state NOT IN ('completed', 'failed', 'cancelled')")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return { rows: [{ count: 1 }], rowCount: 1 };
        }
        if (
          sql.includes('FROM workflow_work_items')
          && sql.includes('parent_work_item_id = $3')
          && sql.includes('stage_name = $4')
          && sql.includes('completed_at IS NULL')
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1', 'review', null]);
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[2]).toBe('wi-impl-1');
          expect(params?.[4]).toBe('review');
          return {
            rows: [
              {
                id: 'wi-review-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'wi-impl-1',
                stage_name: 'review',
                column_id: 'planned',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT ws.id,') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'implementation',
                position: 0,
                goal: 'Ship the change',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-18T15:00:00Z'),
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-18T15:00:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'review',
                position: 1,
                goal: 'Review the implementation',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-18T15:01:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-3',
                lifecycle: 'planned',
                name: 'release',
                position: 2,
                goal: 'Release the change',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
            rowCount: 3,
          };
        }
        if (sql.includes('UPDATE workflow_work_items')) {
          throw new Error('predecessor checkpoint should not auto-close while review is still pending');
        }
        if (sql.includes('UPDATE workflow_stages') || sql.includes('UPDATE workflows')) {
          throw new Error(`Unexpected SQL: ${sql}`);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        request_id: 'req-review-1',
        parent_work_item_id: 'wi-impl-1',
        stage_name: 'review',
        title: 'Review checkpoint',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'wi-review-1',
        parent_work_item_id: 'wi-impl-1',
        stage_name: 'review',
      }),
    );
  });

  it('rejects planned successor work-item creation when it skips the immediate next checkpoint', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'implementation',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'product-manager'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }, { id: 'done', label: 'Done', is_terminal: true }] },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the implementation' },
                    { name: 'release', goal: 'Release the change' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-impl-1']);
          return {
            rows: [
              {
                id: 'wi-impl-1',
                title: 'Implementation checkpoint',
                stage_name: 'implementation',
                column_id: 'planned',
                completed_at: null,
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks')) {
          throw new Error('skip-stage validation should fail before task-state inspection');
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('skipped successor checkpoint insert must be rejected');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-release-1',
          parent_work_item_id: 'wi-impl-1',
          stage_name: 'release',
          title: 'Release checkpoint',
        },
      ),
    ).rejects.toThrowError(ValidationError);
  });

  it('reuses an open planned child checkpoint in the same stage after rework instead of inserting a duplicate', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'review',
                lifecycle: 'planned',
                definition: {
                  roles: ['developer', 'reviewer', 'qa'],
                  lifecycle: 'planned',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [
                    { name: 'implementation', goal: 'Ship the change' },
                    { name: 'review', goal: 'Review the change' },
                    { name: 'verification', goal: 'Verify the change' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi') && sql.includes('latest_handoff_completion')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [
              {
                id: 'implementation-item',
                title: 'Implementation checkpoint',
                stage_name: 'implementation',
                column_id: 'done',
                completed_at: new Date('2026-03-21T04:00:00Z'),
                human_gate: false,
                gate_status: 'not_requested',
                latest_handoff_completion: 'full',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.startsWith('SELECT COUNT(*)::int AS count') && sql.includes('FROM tasks')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation-item']);
          return {
            rows: [{ count: 0 }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM workflow_work_items')
          && sql.includes('parent_work_item_id = $3')
          && sql.includes('stage_name = $4')
          && sql.includes('completed_at IS NULL')
        ) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'implementation-item',
            'review',
            'reviewer',
          ]);
          return {
            rows: [
              {
                id: 'review-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'implementation-item',
                request_id: 'req-review-1',
                stage_name: 'review',
                title: 'Review checkpoint',
                goal: 'Review the implementation',
                acceptance_criteria: 'Review and approve the change.',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: 'developer',
                next_expected_action: 'rework',
                rework_count: 0,
                priority: 'normal',
                notes: 'Open review item awaiting resubmission',
                created_by: 'system',
                metadata: {
                  orchestrator_finish_state: {
                    next_expected_actor: 'developer',
                    next_expected_action: 'rework',
                  },
                },
                completed_at: null,
                created_at: new Date('2026-03-21T03:54:36Z'),
                updated_at: new Date('2026-03-21T03:58:32Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (
          sql.includes('UPDATE workflow_work_items')
          && sql.includes("metadata = COALESCE(metadata, '{}'::jsonb) - 'orchestrator_finish_state'")
        ) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'review-item-1']);
          return {
            rows: [
              {
                id: 'review-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: 'implementation-item',
                request_id: 'req-review-1',
                stage_name: 'review',
                title: 'Review checkpoint',
                goal: 'Review the implementation',
                acceptance_criteria: 'Review and approve the change.',
                column_id: 'planned',
                owner_role: 'reviewer',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: 'Open review item awaiting resubmission',
                created_by: 'system',
                metadata: {},
                completed_at: null,
                created_at: new Date('2026-03-21T03:54:36Z'),
                updated_at: new Date('2026-03-21T04:00:00Z'),
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          throw new Error('duplicate review checkpoint should not be inserted');
        }
        if (sql.includes('UPDATE workflow_stages') || sql.includes('UPDATE workflows')) {
          throw new Error(`Unexpected SQL: ${sql}`);
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        request_id: 'req-review-2',
        parent_work_item_id: 'implementation-item',
        stage_name: 'review',
        owner_role: 'reviewer',
        title: 'Review checkpoint',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'review-item-1',
        parent_work_item_id: 'implementation-item',
        stage_name: 'review',
        owner_role: 'reviewer',
        next_expected_actor: null,
        next_expected_action: null,
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('uses the playbook default stage for planned work items when stage_name is omitted', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'implementation',
                lifecycle: 'planned',
                definition: {
                  roles: ['implementer'],
                  lifecycle: 'planned',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [
                    { name: 'requirements', goal: 'Define scope' },
                    { name: 'implementation', goal: 'Ship code' },
                  ],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          expect(sql).not.toContain('SELECT *');
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(sql).not.toContain('RETURNING *');
          expect(params?.[4]).toBe('requirements');
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                stage_name: 'requirements',

                column_id: 'planned',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('SELECT ws.id,') && sql.includes('FROM workflow_stages ws')) {
          return {
            rows: [
              {
                id: 'stage-1',
                lifecycle: 'planned',
                name: 'requirements',
                position: 0,
                goal: 'Define scope',
                guidance: null,
                human_gate: false,
                status: 'active',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: new Date('2026-03-17T20:00:00Z'),
                completed_at: null,
                open_work_item_count: 1,
                total_work_item_count: 1,
                first_work_item_at: new Date('2026-03-17T20:00:00Z'),
                last_completed_work_item_at: null,
              },
              {
                id: 'stage-2',
                lifecycle: 'planned',
                name: 'implementation',
                position: 1,
                goal: 'Ship code',
                guidance: null,
                human_gate: false,
                status: 'pending',
                gate_status: 'not_requested',
                iteration_count: 0,
                summary: null,
                started_at: null,
                completed_at: null,
                open_work_item_count: 0,
                total_work_item_count: 0,
                first_work_item_at: null,
                last_completed_work_item_at: null,
              },
            ],
            rowCount: 2,
          };
        }
        if (sql.includes('UPDATE workflows')) {
          throw new Error('planned work-item reconciliation should not persist workflow.current_stage');
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      pool as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        request_id: 'req-1',
        title: 'Backfill scope notes',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        stage_name: 'requirements',
      }),
    );
    expect(result).not.toHaveProperty('current_checkpoint');
  });

  it('marks webhook-triggered work items as webhook-created and emits system-scoped events', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['triager'],
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [{ name: 'triage', goal: 'Triage inbound work' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          expect(sql).not.toContain('SELECT *');
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(params?.[4]).toBe('triage');
          expect(params?.[12]).toBe(0);
          expect(params?.[15]).toBe('webhook');
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                stage_name: 'triage',

                column_id: 'planned',
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      pool as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'trigger:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'webhook_trigger',
        ownerId: null,
        keyPrefix: 'trigger:trigger-1',
      },
      'workflow-1',
      {
        request_id: 'trigger:trigger-1:evt-1',
        title: 'Incoming webhook item',
      },
    );

    expect(result.id).toBe('work-item-1');
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item.created',
        entityType: 'work_item',
        entityId: 'work-item-1',
        actorType: 'system',
        actorId: 'trigger:trigger-1',
        data: expect.objectContaining({
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
        }),
      }),
      client,
    );
    expect(activationService.enqueueForWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'system',
        actorId: 'trigger:trigger-1',
        requestId: 'work-item:trigger:trigger-1:evt-1',
      }),
      client,
    );
  });

  it('returns the existing work item when request_id conflicts', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
                definition: {
                  roles: ['triager'],
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [{ name: 'triage', goal: 'Triage inbound work' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          expect(sql).not.toContain('RETURNING *');
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          expect(sql).not.toContain('SELECT *');
          expect(params).toEqual(['tenant-1', 'workflow-1', 'req-1']);
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                request_id: 'req-1',
                parent_work_item_id: null,
                stage_name: 'triage',

                title: 'Incoming webhook item',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: null,
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    const activationService = { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) };
    const activationDispatchService = { dispatchActivation: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemService(
      pool as never,
      eventService as never,
      activationService as never,
      activationDispatchService as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        request_id: 'req-1',
        title: 'Incoming webhook item',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        request_id: 'req-1',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(activationService.enqueueForWorkflow).not.toHaveBeenCalled();
    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
  });

  it('rejects a request_id replay when the existing work item does not match the requested mutation', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['triager'],
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [{ name: 'triage', goal: 'Triage inbound work' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                request_id: 'req-1',
                parent_work_item_id: null,
                stage_name: 'triage',
                title: 'Existing title',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                priority: 'normal',
                notes: null,
                metadata: {},
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      service.createWorkItem(
        {
          id: 'admin:1',
          tenantId: 'tenant-1',
          scope: 'admin',
          ownerType: 'tenant',
          ownerId: 'tenant-1',
          keyPrefix: 'admin-key',
        },
        'workflow-1',
        {
          request_id: 'req-1',
          title: 'New title',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('treats metadata with reordered object keys as the same work-item replay', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                active_stage_name: 'triage',
                lifecycle: 'ongoing',
                definition: {
                  roles: ['triager'],
                  lifecycle: 'ongoing',
                  board: { columns: [{ id: 'planned', label: 'Planned' }] },
                  stages: [{ name: 'triage', goal: 'Triage inbound work' }],
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('request_id = $3')) {
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                request_id: 'req-1',
                parent_work_item_id: null,
                stage_name: 'triage',

                title: 'Existing title',
                goal: null,
                acceptance_criteria: null,
                column_id: 'planned',
                owner_role: null,
                next_expected_actor: null,
                next_expected_action: null,
                rework_count: 0,
                priority: 'normal',
                notes: null,
                metadata: {
                  nested: { first: 'one', second: 'two' },
                  status: 'open',
                },
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        request_id: 'req-1',
        title: 'Existing title',
        metadata: {
          status: 'open',
          nested: { second: 'two', first: 'one' },
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'work-item-1',
        request_id: 'req-1',
      }),
    );
  });

  it('redacts plaintext secrets from create-work-item responses', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          expect(sql).toContain('FOR UPDATE OF w');
          return {
            rows: [{
              id: 'workflow-1',
              active_stage_name: 'triage',
              definition: {
                roles: ['triager'],
                lifecycle: 'ongoing',
                board: { columns: [{ id: 'planned', label: 'Planned' }] },
                stages: [{ name: 'triage', goal: 'Triage inbound work' }],
              },
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('INSERT INTO workflow_work_items')) {
          return {
            rows: [{
              id: 'work-item-1',
              workflow_id: 'workflow-1',
              stage_name: 'triage',
              column_id: 'planned',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
              metadata: {
                webhook_secret: 'plaintext-secret',
                secret_ref: 'secret:WORK_ITEM_SECRET',
              },
            }],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      release: vi.fn(),
    };
    const service = new WorkItemService(
      { connect: vi.fn().mockResolvedValue(client) } as never,
      { emit: vi.fn().mockResolvedValue(undefined) } as never,
      { enqueueForWorkflow: vi.fn().mockResolvedValue({ id: 'activation-1' }) } as never,
      { dispatchActivation: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await service.createWorkItem(
      {
        id: 'admin:1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'tenant',
        ownerId: 'tenant-1',
        keyPrefix: 'admin-key',
      },
      'workflow-1',
      {
        title: 'Create item',
        metadata: { webhook_secret: 'plaintext-secret' },
      },
    );

    expect((result as Record<string, any>).metadata.webhook_secret).toBe('redacted://work-item-secret');
    expect((result as Record<string, any>).metadata.secret_ref).toBe('redacted://work-item-secret');
  });

  it('lists work-item tasks through a dedicated subresource query', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id, wi.workflow_id, w.workspace_id')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rows: [{ id: 'work-item-1', workflow_id: 'workflow-1', workspace_id: 'workspace-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('work_item_id = $3')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rows: [
              {
                id: 'task-1',
                workflow_id: 'workflow-1',
                work_item_id: 'work-item-1',
                title: 'Implement feature',
                state: 'ready',
                role: 'developer',
                stage_name: 'implementation',
                activation_id: 'activation-1',
                is_orchestrator_task: false,
                created_at: '2026-03-11T00:00:00.000Z',
                completed_at: null,
                depends_on: [],
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const tasks = await service.listWorkItemTasks('tenant-1', 'workflow-1', 'work-item-1');

    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'task-1',
        work_item_id: 'work-item-1',
        stage_name: 'implementation',
      }),
    ]);
  });

  it('lists work-item events through a dedicated subresource query', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id, wi.workflow_id, w.workspace_id')) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'work-item-1']);
          return {
            rows: [{ id: 'work-item-1', workflow_id: 'workflow-1', workspace_id: 'workspace-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM events')) {
          expect(sql).toContain('ORDER BY created_at DESC, id DESC');
          expect(params).toEqual(['tenant-1', 'work-item-1', 'workflow-1', 'work-item-1', 50]);
          return {
            rows: [
              {
                id: 1,
                entity_type: 'work_item',
                entity_id: 'work-item-1',
                type: 'work_item.updated',
                data: { workflow_id: 'workflow-1', work_item_id: 'work-item-1' },
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const events = await service.listWorkItemEvents('tenant-1', 'workflow-1', 'work-item-1', 50);

    expect(events).toEqual([
      expect.objectContaining({
        entity_type: 'work_item',
        entity_id: 'work-item-1',
        type: 'work_item.updated',
      }),
    ]);
  });

  it('redacts plaintext secrets from work-item metadata and event payloads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('SELECT wi.id, wi.workflow_id, w.workspace_id')) {
          return {
            rows: [{ id: 'work-item-1', workflow_id: 'workflow-1', workspace_id: 'workspace-1' }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'triage',

                column_id: 'planned',
                next_expected_actor: 'reviewer',
                next_expected_action: 'assess',
                rework_count: 2,
                metadata: {
                  webhook_secret: 'plaintext-secret',
                  secret_ref: 'secret:WORK_ITEM_SECRET',
                },
                task_count: '0',
                children_count: '0',
                children_completed: '0',
              },
            ],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM events')) {
          return {
            rows: [
              {
                id: 1,
                entity_type: 'work_item',
                entity_id: 'work-item-1',
                type: 'work_item.updated',
                data: {
                  api_key: 'sk-event-secret',
                  secret_ref: 'secret:EVENT_TOKEN',
                },
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const [workItem] = await service.listWorkflowWorkItems('tenant-1', 'workflow-1');
    const [event] = await service.listWorkItemEvents('tenant-1', 'workflow-1', 'work-item-1', 20);

    expect((workItem as Record<string, any>).metadata.webhook_secret).toBe('redacted://work-item-secret');
    expect((workItem as Record<string, any>).metadata.secret_ref).toBe('redacted://work-item-secret');
    expect((workItem as Record<string, any>).stage_name).toBe('triage');
    expect((workItem as Record<string, any>).current_checkpoint).toBeUndefined();
    expect((workItem as Record<string, any>).next_expected_actor).toBe('reviewer');
    expect((workItem as Record<string, any>).next_expected_action).toBe('assess');
    expect((workItem as Record<string, any>).rework_count).toBe(2);
    expect((event as Record<string, any>).data.api_key).toBe('redacted://work-item-secret');
    expect((event as Record<string, any>).data.secret_ref).toBe('redacted://work-item-secret');
  });

  it('preserves timestamp fields while redacting work-item secrets', async () => {
    const completedAt = new Date('2026-03-16T11:42:54.378Z');
    const createdAt = new Date('2026-03-16T11:40:00.000Z');
    const updatedAt = new Date('2026-03-16T11:42:54.378Z');
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM workflow_work_items wi')) {
          expect(params).toEqual(['tenant-1', 'workflow-1']);
          return {
            rows: [
              {
                id: 'work-item-1',
                workflow_id: 'workflow-1',
                parent_work_item_id: null,
                stage_name: 'requirements',

                column_id: 'done',
                completed_at: completedAt,
                created_at: createdAt,
                updated_at: updatedAt,
                metadata: {
                  webhook_secret: 'plaintext-secret',
                },
                task_count: '0',
                children_count: '0',
                children_completed: '0',
              },
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const [workItem] = await service.listWorkflowWorkItems('tenant-1', 'workflow-1');

    expect((workItem as Record<string, any>).metadata.webhook_secret).toBe('redacted://work-item-secret');
    expect((workItem as Record<string, any>).completed_at).toEqual(completedAt);
    expect((workItem as Record<string, any>).created_at).toEqual(createdAt);
    expect((workItem as Record<string, any>).updated_at).toEqual(updatedAt);
  });

  it('lists milestone-aware work items with filters and grouped children', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).not.toContain('wi.*');
        expect(sql).toContain('COUNT(DISTINCT child.id)::int AS children_count');
        expect(sql).toContain('COUNT(DISTINCT child.id) FILTER (WHERE child.completed_at IS NOT NULL)::int AS children_completed');
        expect(sql).toContain('wi.stage_name = $3');
        expect(sql).toContain('wi.column_id = $4');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'implementation', 'active']);
        return {
          rows: [
            {
              id: 'wi-parent',
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Auth milestone',
              column_id: 'active',
              priority: 'high',
              task_count: '1',
              children_count: '2',
              children_completed: '1',
              created_at: '2026-03-11T00:00:00.000Z',
            },
            {
              id: 'wi-child',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
          ],
          rowCount: 2,
        };
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItems = await service.listWorkflowWorkItems('tenant-1', 'workflow-1', {
      stage_name: 'implementation',
      column_id: 'active',
      grouped: true,
    });

    expect(workItems).toEqual([
      expect.objectContaining({
        id: 'wi-parent',
        task_count: 1,
        children_count: 2,
        children_completed: 1,
        is_milestone: true,
        children: [
          expect.objectContaining({
            id: 'wi-child',
            parent_work_item_id: 'wi-parent',
            children_count: 0,
            children_completed: 0,
            is_milestone: false,
            task_count: 2,
          }),
        ],
      }),
    ]);
  });

  it('filters work items by parent_work_item_id for child reads', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).toContain('wi.parent_work_item_id = $3');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'wi-parent']);
        return {
          rows: [
            {
              id: 'wi-child',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItems = await service.listWorkflowWorkItems('tenant-1', 'workflow-1', {
      parent_work_item_id: 'wi-parent',
    });

    expect(workItems).toEqual([
      expect.objectContaining({
        id: 'wi-child',
        parent_work_item_id: 'wi-parent',
        children_count: 0,
        children_completed: 0,
        is_milestone: false,
      }),
    ]);
  });

  it('returns a work item with milestone children when requested', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-parent',
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Auth milestone',
              column_id: 'active',
              priority: 'high',
              task_count: '1',
              children_count: '2',
              children_completed: '1',
              created_at: '2026-03-11T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-child-1',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
            {
              id: 'wi-child-2',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth review',
              column_id: 'review',
              priority: 'normal',
              task_count: '1',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:02:00.000Z',
            },
          ],
          rowCount: 2,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'workflow-1', 'wi-parent', {
      include_children: true,
    });

    expect(workItem).toEqual(
      expect.objectContaining({
        id: 'wi-parent',
        children_count: 2,
        children_completed: 1,
        is_milestone: true,
        children: [
          expect.objectContaining({ id: 'wi-child-1', is_milestone: false }),
          expect.objectContaining({ id: 'wi-child-2', is_milestone: false }),
        ],
      }),
    );
  });

  it('returns milestone children by default when the selected work item is a parent', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-parent',
              workflow_id: 'workflow-1',
              parent_work_item_id: null,
              stage_name: 'implementation',
              title: 'Auth milestone',
              column_id: 'active',
              priority: 'high',
              task_count: '1',
              children_count: '1',
              children_completed: '0',
              created_at: '2026-03-11T00:00:00.000Z',
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'wi-child-1',
              workflow_id: 'workflow-1',
              parent_work_item_id: 'wi-parent',
              stage_name: 'implementation',
              title: 'Auth implementation',
              column_id: 'active',
              priority: 'normal',
              task_count: '2',
              children_count: '0',
              children_completed: '0',
              created_at: '2026-03-11T00:01:00.000Z',
            },
          ],
          rowCount: 1,
        }),
    };
    const service = new WorkItemService(
      pool as never,
      { emit: vi.fn() } as never,
      { enqueueForWorkflow: vi.fn() } as never,
      { dispatchActivation: vi.fn() } as never,
    );

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'workflow-1', 'wi-parent');

    expect(workItem).toEqual(
      expect.objectContaining({
        id: 'wi-parent',
        children: [expect.objectContaining({ id: 'wi-child-1' })],
      }),
    );
  });

  it('returns latest gate feedback in the work-item continuity model', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain('workflow_stage_gates');
        return {
          rowCount: 1,
          rows: [
            {
              id: 'wi-1',
              workflow_id: 'wf-1',
              parent_work_item_id: null,
              stage_name: 'release',
              column_id: 'planned',
              owner_role: 'product-manager',
              next_expected_actor: 'human',
              next_expected_action: 'approve',
              rework_count: 2,
              latest_handoff_completion: 'full',
              unresolved_findings: ['Replace the static page with the required CLI entrypoint.'],
              focus_areas: ['Release deliverable must match approved CLI scope.'],
              known_risks: ['Release package is blocked until the CLI deliverable exists.'],
              task_count: 1,
              children_count: 0,
              children_completed: 0,
              completed_at: null,
              gate_status: 'rejected',
              gate_decision_feedback:
                'Release approval rejected: expected CLI entrypoint hello.py is missing from the workflow branch.',
              gate_decided_at: new Date('2026-03-16T16:31:49.959Z'),
            },
          ],
        };
      }),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'wf-1', 'wi-1');

    expect(workItem).toMatchObject({
      id: 'wi-1',
      workflow_id: 'wf-1',
      stage_name: 'release',
      gate_status: 'rejected',
      gate_decision_feedback:
        'Release approval rejected: expected CLI entrypoint hello.py is missing from the workflow branch.',
    });
    expect(workItem).not.toHaveProperty('current_checkpoint');
    expect(workItem.gate_decided_at).toEqual(new Date('2026-03-16T16:31:49.959Z'));
  });

  it('suppresses forward-looking continuity details for completed work items', async () => {
    const completedAt = new Date('2026-03-16T16:31:49.959Z');
    const pool = {
      query: vi.fn(async () => ({
        rowCount: 1,
        rows: [
          {
            id: 'wi-1',
            workflow_id: 'wf-1',
            parent_work_item_id: null,
            stage_name: 'release',
            column_id: 'done',
            owner_role: 'product-manager',
            next_expected_actor: 'human',
            next_expected_action: 'approve',
            rework_count: 2,
            latest_handoff_completion: 'full',
            unresolved_findings: ['Release package is blocked until the CLI deliverable exists.'],
            focus_areas: ['Release deliverable must match approved CLI scope.'],
            known_risks: ['Release package is blocked until the CLI deliverable exists.'],
            task_count: 1,
            children_count: 0,
            children_completed: 0,
            completed_at: completedAt,
            gate_status: 'approved',
            gate_decision_feedback: 'Looks good.',
            gate_decided_at: completedAt,
          },
        ],
      })),
    };

    const service = new WorkItemService(pool as never, {} as never, {} as never, {} as never);

    const workItem = await service.getWorkflowWorkItem('tenant-1', 'wf-1', 'wi-1');

    expect(workItem).toMatchObject({
      id: 'wi-1',
      column_id: 'done',
      completed_at: completedAt,
      next_expected_actor: null,
      next_expected_action: null,
      unresolved_findings: [],
      focus_areas: [],
    });
    expect(workItem.known_risks).toEqual(['Release package is blocked until the CLI deliverable exists.']);
  });
});
