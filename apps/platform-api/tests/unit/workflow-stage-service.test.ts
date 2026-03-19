import { describe, expect, it, vi } from 'vitest';

import { WorkflowStageService } from '../../src/services/workflow-stage-service.js';

describe('WorkflowStageService', () => {
  it('treats the earliest open successor stage as active for planned workflows', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'workflow-1' }] })
        .mockResolvedValueOnce({
          rowCount: 3,
          rows: [
            {
              id: 'stage-1',
              lifecycle: 'planned',
              name: 'implementation',
              position: 0,
              goal: 'Implement',
              guidance: null,
              human_gate: false,
              status: 'active',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              started_at: new Date('2026-03-11T00:00:00Z'),
              completed_at: null,
              open_work_item_count: 0,
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-11T00:00:00Z'),
              last_completed_work_item_at: new Date('2026-03-11T00:30:00Z'),
            },
            {
              id: 'stage-2',
              lifecycle: 'planned',
              name: 'review',
              position: 1,
              goal: 'Review',
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
              first_work_item_at: new Date('2026-03-11T01:00:00Z'),
              last_completed_work_item_at: null,
            },
            {
              id: 'stage-3',
              lifecycle: 'planned',
              name: 'release',
              position: 2,
              goal: 'Release',
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
              first_work_item_at: new Date('2026-03-11T02:00:00Z'),
              last_completed_work_item_at: null,
            },
          ],
        }),
    };

    const service = new WorkflowStageService(pool as never);
    const stages = await service.listStages('tenant-1', 'workflow-1');

    expect(stages).toEqual([
      expect.objectContaining({
        name: 'implementation',
        status: 'completed',
        is_active: false,
        started_at: '2026-03-11T00:00:00.000Z',
        completed_at: '2026-03-11T00:30:00.000Z',
      }),
      expect.objectContaining({
        name: 'review',
        status: 'active',
        is_active: true,
        started_at: '2026-03-11T01:00:00.000Z',
      }),
      expect.objectContaining({
        name: 'release',
        status: 'pending',
        is_active: false,
        started_at: null,
      }),
    ]);
  });

  it('derives continuous stage status from open work items and gate state', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'workflow-1' }] })
        .mockResolvedValueOnce({
          rowCount: 3,
          rows: [
            {
              id: 'stage-1',
              lifecycle: 'ongoing',
              name: 'triage',
              position: 0,
              goal: 'Triage',
              guidance: null,
              human_gate: false,
              status: 'pending',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
              open_work_item_count: 2,
              total_work_item_count: 2,
              first_work_item_at: new Date('2026-03-11T00:00:00Z'),
              last_completed_work_item_at: null,
            },
            {
              id: 'stage-2',
              lifecycle: 'ongoing',
              name: 'review',
              position: 1,
              goal: 'Review',
              guidance: null,
              human_gate: true,
              status: 'pending',
              gate_status: 'awaiting_approval',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
              open_work_item_count: 0,
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-11T01:00:00Z'),
              last_completed_work_item_at: new Date('2026-03-11T02:00:00Z'),
            },
            {
              id: 'stage-3',
              lifecycle: 'ongoing',
              name: 'done',
              position: 2,
              goal: 'Done',
              guidance: null,
              human_gate: false,
              status: 'active',
              gate_status: 'not_requested',
              iteration_count: 0,
              summary: null,
              started_at: new Date('2026-03-11T03:00:00Z'),
              completed_at: null,
              open_work_item_count: 0,
              total_work_item_count: 3,
              first_work_item_at: new Date('2026-03-11T03:00:00Z'),
              last_completed_work_item_at: new Date('2026-03-11T04:00:00Z'),
            },
          ],
        }),
    };

    const service = new WorkflowStageService(pool as never);
    const stages = await service.listStages('tenant-1', 'workflow-1');

    expect(stages).toEqual([
      expect.objectContaining({
        name: 'triage',
        status: 'active',
        is_active: true,
        started_at: '2026-03-11T00:00:00.000Z',
        completed_at: null,
        open_work_item_count: 2,
      }),
      expect.objectContaining({
        name: 'review',
        status: 'awaiting_gate',
        is_active: true,
        completed_at: null,
      }),
      expect.objectContaining({
        name: 'done',
        status: 'completed',
        is_active: false,
        completed_at: '2026-03-11T04:00:00.000Z',
      }),
    ]);
  });

  it('marks rejected continuous stages as active blockers', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'workflow-1' }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'stage-1',
              lifecycle: 'ongoing',
              name: 'review',
              position: 1,
              goal: 'Review',
              guidance: null,
              human_gate: true,
              status: 'pending',
              gate_status: 'rejected',
              iteration_count: 0,
              summary: null,
              started_at: null,
              completed_at: null,
              open_work_item_count: 0,
              total_work_item_count: 1,
              first_work_item_at: new Date('2026-03-11T01:00:00Z'),
              last_completed_work_item_at: new Date('2026-03-11T02:00:00Z'),
            },
          ],
        }),
    };

    const service = new WorkflowStageService(pool as never);
    const stages = await service.listStages('tenant-1', 'workflow-1');

    expect(stages).toEqual([
      expect.objectContaining({
        name: 'review',
        status: 'blocked',
        is_active: true,
      }),
    ]);
  });

  it('does not mark an approved continuous stage as completed without work items', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'workflow-1' }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'stage-1',
              lifecycle: 'ongoing',
              name: 'review',
              position: 1,
              goal: 'Review',
              guidance: null,
              human_gate: true,
              status: 'completed',
              gate_status: 'approved',
              iteration_count: 0,
              summary: null,
              started_at: new Date('2026-03-11T01:00:00Z'),
              completed_at: new Date('2026-03-11T02:00:00Z'),
              open_work_item_count: 0,
              total_work_item_count: 0,
              first_work_item_at: null,
              last_completed_work_item_at: null,
            },
          ],
        }),
    };

    const service = new WorkflowStageService(pool as never);
    const stages = await service.listStages('tenant-1', 'workflow-1');

    expect(stages).toEqual([
      expect.objectContaining({
        name: 'review',
        status: 'pending',
        is_active: false,
        started_at: '2026-03-11T01:00:00.000Z',
        completed_at: null,
        total_work_item_count: 0,
      }),
    ]);
  });
});
