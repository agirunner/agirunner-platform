import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { HandoffService } from '../../../src/services/handoff-service/handoff-service.js';
import { makeTaskRow } from './handoff-service.fixtures.js';

describe('HandoffService guided closure restrictions', () => {
  it('rejects conflicting legacy and explicit handoff state fields', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          id: 'task-qa-4',
          role: 'policy-reviewer',
          work_item_id: 'work-item-verify-1',
          stage_name: 'verification',
          input: {
            subject_task_id: 'task-dev-1',
            subject_work_item_id: 'work-item-impl-1',
            subject_revision: 3,
          },
          metadata: { task_kind: 'assessment', team_name: 'delivery' },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-qa-4', {
      request_id: 'req-qa-4',
      summary: 'Conflicting payload',
      completion: 'full',
      completion_state: 'blocked',
      resolution: 'approved',
      decision_state: 'blocked',
    } as never)).rejects.toThrowError(
      new ValidationError('completion/completion_state and resolution/decision_state must agree when both are provided'),
    );
  });

  it('rejects resolution on ordinary delivery task handoffs', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          metadata: { team_name: 'delivery' },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      resolution: 'approved',
    })).rejects.toThrowError(new ValidationError('resolution, outcome_action_applied, and closure_effect are only allowed on assessment or approval handoffs'));

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('rejects blocked resolution on ordinary delivery task handoffs', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          metadata: { team_name: 'delivery' },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Blocked on missing credentials.',
      completion: 'full',
      resolution: 'blocked' as never,
    })).rejects.toThrowError(new ValidationError('resolution, outcome_action_applied, and closure_effect are only allowed on assessment or approval handoffs'));

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('rejects resolution on delivery handoffs that carry subject lineage', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          role: 'implementation-engineer',
          input: { subject_task_id: 'task-architect-1', subject_revision: 1 },
          metadata: { task_kind: 'delivery', team_name: 'delivery', output_revision: 1 },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented the requested change.',
      completion: 'full',
      resolution: 'approved',
    })).rejects.toThrowError(new ValidationError('resolution, outcome_action_applied, and closure_effect are only allowed on assessment or approval handoffs'));

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('rejects continue as an explicit outcome action', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [makeTaskRow({
          id: 'task-qa-1',
          role: 'quality-reviewer',
          stage_name: 'review',
          input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
          metadata: { task_kind: 'assessment', team_name: 'delivery' },
        })],
        rowCount: 1,
      }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-1',
      summary: 'Assessment completed.',
      completion: 'full',
      resolution: 'approved',
      outcome_action_applied: 'continue' as never,
    })).rejects.toThrowError(new ValidationError(
      'outcome_action_applied must be omitted for ordinary continuation; use it only for reopen_subject, route_to_role, block_subject, escalate, or terminate_branch',
    ));

    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
