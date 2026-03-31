import { describe, expect, it, vi } from 'vitest';

import { HandoffService } from '../../../src/services/handoff-service.js';
import { makeHandoffRow, makeTaskRow } from './handoff-service.fixtures.js';

describe('HandoffService predecessor lookup', () => {
  it('loads the predecessor handoff for a task-scoped chain', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [makeTaskRow({
            id: 'task-2',
            role: 'reviewer',
            stage_name: 'review',
          })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            ...makeHandoffRow({
              id: 'handoff-1',
              task_id: 'task-1',
              request_id: 'req-1',
              summary: 'sk-predecessor-secret',
              successor_context: 'Bearer predecessor-secret',
              role_data: { api_key: 'sk-predecessor-secret' },
            }),
          }],
          rowCount: 1,
        }),
    };

    const logService = { insert: vi.fn().mockResolvedValue(undefined) };
    const service = new HandoffService(pool as never, logService as never);
    const result = await service.getPredecessorHandoff('tenant-1', 'task-2');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        summary: 'redacted://handoff-secret',
        successor_context: 'redacted://handoff-secret',
        role_data: { api_key: 'redacted://handoff-secret' },
      }),
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.predecessor_handoff.lookup',
        taskId: 'task-2',
        workItemId: 'work-item-1',
        stageName: 'review',
        role: 'reviewer',
        payload: expect.objectContaining({
          current_workflow_id: 'workflow-1',
          current_work_item_id: 'work-item-1',
          current_task_id: 'task-2',
          resolution_source: 'local_work_item',
          has_predecessor_handoff: true,
          candidate_handoff_ids: ['handoff-1'],
          candidate_task_ids: ['task-1'],
          selected_handoff_id: 'handoff-1',
          selected_handoff_workflow_id: 'workflow-1',
          selected_handoff_work_item_id: 'work-item-1',
          selected_handoff_role: 'developer',
          selected_handoff_sequence: 0,
        }),
      }),
    );
  });

  it('loads the predecessor handoff from the parent-linked work item when the current work item has no local handoff', async () => {
    const pool = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM tasks') && sql.includes('LIMIT 1')) {
          return {
            rows: [makeTaskRow({
              id: 'task-release-1',
              role: 'product-manager',
              stage_name: 'release',
              work_item_id: 'work-item-release',
            })],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'work-item-release'
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('FROM workflow_work_items') && sql.includes('parent_work_item_id')) {
          return {
            rows: [{ parent_work_item_id: 'work-item-verification' }],
            rowCount: 1,
          };
        }
        if (
          sql.includes('FROM task_handoffs') &&
          sql.includes('AND work_item_id = $3') &&
          Array.isArray(params) &&
          params[2] === 'work-item-verification'
        ) {
          return {
            rows: [{
              ...makeHandoffRow({
                id: 'handoff-qa-1',
                task_id: 'task-qa-1',
                work_item_id: 'work-item-verification',
                role: 'qa',
                summary: 'QA validated the branch successfully.',
                decisions: ['Release can proceed'],
                focus_areas: ['Human release approval'],
                successor_context: 'Use the QA evidence for release approval.',
                created_at: new Date('2026-03-16T12:00:00Z'),
              }),
            }],
            rowCount: 1,
          };
        }
        if (sql.includes('FROM task_handoffs') && sql.includes('ORDER BY created_at DESC')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.getPredecessorHandoff('tenant-1', 'task-release-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        role: 'qa',
        successor_context: 'Use the QA evidence for release approval.',
      }),
    );
  });
});
