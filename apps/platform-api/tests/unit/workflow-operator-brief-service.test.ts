import { beforeEach, describe, expect, it } from 'vitest';

import { createWorkflowOperatorBriefRow, createWorkflowOperatorBriefServiceTestContext } from './workflow-operator-brief-service.test-support.js';

describe('WorkflowOperatorBriefService', () => {
  let pool: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['pool'];
  let service: ReturnType<typeof createWorkflowOperatorBriefServiceTestContext>['service'];

  beforeEach(() => {
    ({ pool, service } = createWorkflowOperatorBriefServiceTestContext());
  });

  it('lists workflow operator briefs newest first with optional work-item filtering', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'work-item-1',
          'work-item-1',
          null,
          null,
          false,
          2,
        ]);
        return {
          rowCount: 2,
          rows: [
            createWorkflowOperatorBriefRow({
              id: 'brief-2',
              work_item_id: 'work-item-1',
              request_id: 'request-2',
              execution_context_id: 'execution-2',
              status_kind: 'in_progress',
              short_brief: { headline: 'Newer brief' },
              detailed_brief_json: { headline: 'Newer brief', status_kind: 'in_progress' },
              linked_target_ids: ['work-item-1'],
              sequence_number: 5,
              created_at: new Date('2026-03-27T18:00:00.000Z'),
              updated_at: new Date('2026-03-27T18:00:00.000Z'),
            }),
            createWorkflowOperatorBriefRow({
              id: 'brief-1',
              work_item_id: 'work-item-1',
              request_id: 'request-1',
              execution_context_id: 'execution-1',
              source_kind: 'specialist',
              source_role_name: 'Verifier',
              status_kind: 'handoff',
              short_brief: { headline: 'Older brief' },
              detailed_brief_json: { headline: 'Older brief', status_kind: 'handoff' },
              sequence_number: 4,
              created_at: new Date('2026-03-27T17:00:00.000Z'),
              updated_at: new Date('2026-03-27T17:00:00.000Z'),
            }),
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listBriefs('tenant-1', 'workflow-1', {
      workItemId: 'work-item-1',
      limit: 2,
    });

    expect(result.map((entry) => entry.id)).toEqual(['brief-2', 'brief-1']);
  });

  it('includes linked-target workflow briefs when a scoped task or work item is selected', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(sql).toContain('linked_target_ids @>');
        expect(sql).toContain('LIMIT $8');
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          'work-item-7',
          'work-item-7',
          'task-4',
          'task-4',
          false,
          5,
        ]);
        return {
          rowCount: 1,
          rows: [
            createWorkflowOperatorBriefRow({
              id: 'brief-linked',
              work_item_id: null,
              task_id: null,
              request_id: 'request-linked',
              execution_context_id: 'activation-1',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              status_kind: 'handoff',
              short_brief: { headline: 'Linked brief' },
              detailed_brief_json: { headline: 'Linked brief', status_kind: 'handoff' },
              linked_target_ids: ['workflow-1', 'work-item-7', 'task-4'],
              sequence_number: 6,
            }),
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listBriefs('tenant-1', 'workflow-1', {
      workItemId: 'work-item-7',
      taskId: 'task-4',
      limit: 5,
    });

    expect(result.map((entry) => entry.id)).toEqual(['brief-linked']);
  });

  it('lists workflow deliverable briefs across work-item scope when rollup is requested', async () => {
    pool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM workflows')) {
        return { rowCount: 1, rows: [{ id: 'workflow-1' }] };
      }
      if (sql.includes('FROM workflow_operator_briefs')) {
        expect(sql).not.toContain('($3::uuid IS NULL AND $5::uuid IS NULL)');
        expect(sql).toContain('ORDER BY sequence_number DESC');
        expect(params).toEqual([
          'tenant-1',
          'workflow-1',
          10,
        ]);
        return {
          rowCount: 2,
          rows: [
            createWorkflowOperatorBriefRow({
              id: 'brief-work-item',
              work_item_id: 'work-item-1',
              request_id: 'request-work-item',
              execution_context_id: 'execution-work-item',
              brief_scope: 'deliverable_context',
              source_kind: 'specialist',
              source_role_name: 'Verifier',
              status_kind: 'completed',
              short_brief: { headline: 'Work-item packet' },
              detailed_brief_json: { headline: 'Work-item packet', status_kind: 'completed' },
              linked_target_ids: ['work-item-1'],
              sequence_number: 2,
              created_at: new Date('2026-03-27T19:00:00.000Z'),
              updated_at: new Date('2026-03-27T19:00:00.000Z'),
            }),
            createWorkflowOperatorBriefRow({
              id: 'brief-workflow',
              work_item_id: null,
              task_id: null,
              request_id: 'request-workflow',
              execution_context_id: 'execution-workflow',
              brief_scope: 'deliverable_context',
              source_kind: 'orchestrator',
              source_role_name: 'Orchestrator',
              status_kind: 'completed',
              short_brief: { headline: 'Workflow packet' },
              detailed_brief_json: { headline: 'Workflow packet', status_kind: 'completed' },
              linked_target_ids: ['workflow-1'],
              sequence_number: 1,
              created_at: new Date('2026-03-27T18:00:00.000Z'),
              updated_at: new Date('2026-03-27T18:00:00.000Z'),
            }),
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await service.listBriefs('tenant-1', 'workflow-1', {
      includeAllWorkItemScopes: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.id)).toEqual(['brief-work-item', 'brief-workflow']);
  });
});
