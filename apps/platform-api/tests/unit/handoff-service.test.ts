import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../src/errors/domain-errors.js';
import { HandoffService } from '../../src/services/handoff-service.js';

describe('HandoffService', () => {
  it('rejects handoffs that reference ephemeral task-local paths', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'requirements',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Drafted the PRD in output/requirements/prd.md and it is ready for review.',
      completion: 'full',
      changes: ['Created PRD markdown at output/requirements/prd.md.'],
      successor_context: 'Read output/requirements/prd.md before reviewing it.',
    })).rejects.toThrowError(
      new ValidationError(
        'Structured handoffs must not reference task-local path "output/requirements/prd.md". Persist output to artifacts/repo/memory and reference artifact ids/logical paths, repo-relative paths, memory keys, and workflow/task ids instead',
      ),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('repairs uploaded output references into stable handoff wording when artifact ids are present', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'requirements',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockImplementationOnce(async (_sql: string, params?: unknown[]) => ({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'requirements',
            sequence: 1,
            summary: String(params?.[10]),
            completion: 'full',
            completion_state: 'full',
            resolution: null,
            decision_state: null,
            closure_effect: null,
            changes: JSON.parse(String(params?.[15])),
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: String(params?.[21]),
            role_data: {},
            artifact_ids: ['artifact-1'],
            created_at: new Date('2026-03-28T02:00:00.000Z'),
          }],
          rowCount: 1,
        })),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Recorded the triage packet in output/workflows-intake-01-triage.md for review.',
      completion: 'full',
      changes: ['Created triage packet at output/workflows-intake-01-triage.md.'],
      successor_context: 'Inspect output/workflows-intake-01-triage.md next.',
      artifact_ids: ['artifact-1'],
    });

    expect(result.summary).toBe(
      'Recorded the triage packet in uploaded artifact workflows-intake-01-triage.md for review.',
    );
    expect(result.changes).toEqual([
      'Created triage packet at uploaded artifact workflows-intake-01-triage.md.',
    ]);
    expect(result.successor_context).toBe(
      'Inspect uploaded artifact workflows-intake-01-triage.md next.',
    );
  });

  it('repairs task-local output references when the handoff already cites a stable artifact logical path', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'requirements',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockImplementationOnce(async (_sql: string, params?: unknown[]) => ({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'requirements',
            sequence: 1,
            summary: String(params?.[10]),
            completion: 'full',
            completion_state: 'full',
            resolution: null,
            decision_state: null,
            closure_effect: null,
            changes: JSON.parse(String(params?.[15])),
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: String(params?.[21]),
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-28T02:00:00.000Z'),
          }],
          rowCount: 1,
        })),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary:
        'Delivered a triage packet. The persisted deliverable is uploaded as artifact artifact:workflow/output/triage-export-retention-clarification.md, with the working file retained at output/triage-export-retention-clarification.md during execution.',
      completion: 'full',
      changes: [
        'Created output/triage-export-retention-clarification.md with the triage summary.',
        'Uploaded the deliverable as artifact artifact:workflow/output/triage-export-retention-clarification.md for downstream review.',
      ],
      successor_context:
        'Review artifact:workflow/output/triage-export-retention-clarification.md instead of output/triage-export-retention-clarification.md.',
    });

    expect(result.summary).not.toContain('retained at output/');
    expect(result.summary).toContain('uploaded artifact triage-export-retention-clarification.md');
    expect(result.changes).toEqual([
      'Created uploaded artifact triage-export-retention-clarification.md with the triage summary.',
      'Uploaded the deliverable as artifact artifact:workflow/output/triage-export-retention-clarification.md for downstream review.',
    ]);
    expect(result.successor_context).toBe(
      'Review artifact:workflow/output/triage-export-retention-clarification.md instead of uploaded artifact triage-export-retention-clarification.md.',
    );
  });

  it('submits a structured task handoff with sequenced persistence', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery', output_revision: 2 },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        sequence: 3,
        focus_areas: ['error handling'],
      }),
    );
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 2,
      }),
    );
  });

  it('promotes delivery handoffs into canonical work-item deliverables after persistence', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery', output_revision: 2 },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Implemented auth flow.',
            completion: 'full',
            completion_state: 'full',
            resolution: null,
            decision_state: null,
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: { task_kind: 'delivery' },
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };
    const promotionService = {
      promoteFromHandoff: vi.fn(async () => null),
    };

    const service = new HandoffService(
      pool as never,
      undefined,
      undefined,
      undefined,
      promotionService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(promotionService.promoteFromHandoff).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        id: 'handoff-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        role_data: expect.objectContaining({
          task_kind: 'delivery',
        }),
      }),
    );
  });

  it('persists guided closure handoff fields without disturbing delivery linkage', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'reviewer',
            stage_name: 'review',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'review', task_kind: 'approval' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-closure-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-guided-1',
            role: 'reviewer',
            team_name: 'review',
            stage_name: 'review',
            sequence: 1,
            summary: 'Request changes with explicit closure guidance.',
            completion: 'full',
            completion_state: 'full',
            resolution: 'request_changes',
            decision_state: 'request_changes',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            recommended_next_actions: [{ action_code: 'continue_work' }],
            waived_steps: [{ code: 'secondary_review', reason: 'Primary review was decisive.' }],
            completion_callouts: { completion_notes: 'Closure still possible.' },
            successor_context: null,
            role_data: { task_kind: 'approval', closure_effect: 'advisory' },
            artifact_ids: [],
            created_at: new Date('2026-03-25T01:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-guided-1',
      summary: 'Request changes with explicit closure guidance.',
      completion: 'full',
      resolution: 'request_changes',
      closure_effect: 'advisory',
      recommended_next_actions: [{
        action_code: 'continue_work',
        target_type: 'work_item',
        target_id: 'work-item-1',
        why: 'Rework can proceed immediately.',
        requires_orchestrator_judgment: false,
      }],
      waived_steps: [{
        code: 'secondary_review',
        reason: 'Primary review already found the decisive issue.',
      }],
      completion_callouts: {
        completion_notes: 'Closure still possible.',
      },
    });

    expect(result).toEqual(expect.objectContaining({
      id: 'handoff-closure-1',
      closure_effect: 'advisory',
      recommended_next_actions: [{ action_code: 'continue_work' }],
      completion_callouts: expect.objectContaining({
        completion_notes: 'Closure still possible.',
      }),
    }));
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[28] ?? '[]'))).toEqual([
      expect.objectContaining({
        action_code: 'continue_work',
        target_id: 'work-item-1',
      }),
    ]);
    expect(JSON.parse(String(insertCall?.[1]?.[29] ?? '[]'))).toEqual([
      expect.objectContaining({
        code: 'secondary_review',
      }),
    ]);
    expect(JSON.parse(String(insertCall?.[1]?.[30] ?? '{}'))).toEqual(
      expect.objectContaining({
        completion_notes: 'Closure still possible.',
        waived_steps: [
          expect.objectContaining({
            code: 'secondary_review',
          }),
        ],
      }),
    );
  });

  it('derives delivery subject revision from rework count when metadata output revision is stale', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 1,
            metadata: { team_name: 'delivery', output_revision: 1 },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 1,
            request_id: 'req-2',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 2,
            summary: 'Implemented the rework.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-22T07:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Implemented the rework.',
      completion: 'full',
    });

    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 2,
      }),
    );
  });

  it('uses the retried delivery task input subject revision when it is newer than stale metadata', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 1,
            is_orchestrator_task: false,
            input: { subject_revision: 3 },
            metadata: { team_name: 'delivery', output_revision: 2 },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 4 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-3',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 1,
            request_id: 'req-3',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 4,
            summary: 'Implemented the revision 3 rework.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-23T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-3',
      summary: 'Implemented the revision 3 rework.',
      completion: 'full',
    });

    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 3,
      }),
    );
  });

  it('rejects stale handoff submissions from an older task rework attempt', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 2,
            is_orchestrator_task: false,
            input: {},
            metadata: { team_name: 'delivery', output_revision: 3 },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-stale-1',
      task_rework_count: 1,
      summary: 'Late handoff from the stale attempt.',
      completion: 'full',
    })).rejects.toThrowError(
      new ConflictError('task handoff submission does not match the current task rework attempt'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('allows resolution on assessment task handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: {
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 1,
            },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            task_id: 'task-qa-1',
            task_rework_count: 0,
            request_id: 'req-qa-1',
            role: 'live-test-qa',
            team_name: 'delivery',
            stage_name: 'verification',
            sequence: 1,
            summary: 'Request changes: verification found an environment gap.',
            completion: 'full',
            resolution: 'request_changes',
            changes: [],
            decisions: [],
            remaining_items: ['Make the documented test command runnable in the supported environment.'],
            blockers: [],
            focus_areas: ['Verification command contract'],
            known_risks: [],
            successor_context: 'Check the repository test command before approving.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-21T18:22:48Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-1',
      summary: 'Request changes: verification found an environment gap.',
      completion: 'full',
      resolution: 'request_changes',
      remaining_items: ['Make the documented test command runnable in the supported environment.'],
      focus_areas: ['Verification command contract'],
      successor_context: 'Check the repository test command before approving.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        resolution: 'request_changes',
        stage_name: 'verification',
      }),
    );
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(JSON.parse(String(insertCall?.[1]?.[22] ?? '{}'))).toEqual(
      expect.objectContaining({
        task_kind: 'assessment',
        subject_task_id: 'task-dev-1',
        subject_work_item_id: 'work-item-impl-1',
        subject_revision: 1,
      }),
    );
  });

  it('requires resolution on successful assessment handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-1',
      summary: 'Verified the fix and collected evidence.',
      completion: 'full',
    })).rejects.toThrowError(
      new ValidationError('resolution is required on full assessment or approval handoffs'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('requires resolution on successful assessment handoffs when the task kind is stored as task_type', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
            metadata: { task_type: 'assessment', team_name: 'delivery' },
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-type-1',
      summary: 'Verified the fix and collected evidence.',
      completion: 'full',
    })).rejects.toThrowError(
      new ValidationError('resolution is required on full assessment or approval handoffs'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('allows blocked assessment handoffs without resolution', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            task_id: 'task-qa-1',
            task_rework_count: 0,
            request_id: 'req-qa-1',
            role: 'live-test-qa',
            team_name: 'delivery',
            stage_name: 'verification',
            sequence: 1,
            summary: 'Blocked by missing test dependency.',
            completion: 'blocked',
            resolution: null,
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: ['Install the missing dependency in the execution image.'],
            focus_areas: [],
            known_risks: [],
            successor_context: 'Re-run verification after the dependency is available.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-21T18:22:48Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-1',
      summary: 'Blocked by missing test dependency.',
      completion: 'blocked',
      blockers: ['Install the missing dependency in the execution image.'],
      successor_context: 'Re-run verification after the dependency is available.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        completion: 'blocked',
        resolution: null,
      }),
    );
  });

  it('allows blocked assessment decisions on successful assessment handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'live-test-qa',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: { subject_task_id: 'task-dev-1', subject_revision: 2 },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-qa-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            task_id: 'task-qa-1',
            task_rework_count: 0,
            request_id: 'req-qa-block-1',
            role: 'live-test-qa',
            team_name: 'delivery',
            stage_name: 'verification',
            sequence: 2,
            summary: 'The subject is blocked on missing production credentials.',
            completion: 'full',
            resolution: 'blocked',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-22T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-1', {
      request_id: 'req-qa-block-1',
      summary: 'The subject is blocked on missing production credentials.',
      completion: 'full',
      resolution: 'blocked' as never,
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-2',
        completion: 'full',
        resolution: 'blocked',
      }),
    );
  });

  it('accepts explicit completion_state and decision_state on assessment handoffs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-3',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'policy-reviewer',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: {
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 3,
            },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-qa-3',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            task_id: 'task-qa-3',
            task_rework_count: 0,
            request_id: 'req-qa-3',
            role: 'policy-reviewer',
            team_name: 'delivery',
            stage_name: 'verification',
            sequence: 3,
            summary: 'Policy blocked the release packet pending legal clarification.',
            completion: 'full',
            completion_state: 'full',
            resolution: 'blocked',
            decision_state: 'blocked',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: ['Legal clarification is required before release.'],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {
              task_kind: 'assessment',
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 3,
            },
            subject_ref: {
              kind: 'task',
              task_id: 'task-dev-1',
              work_item_id: 'work-item-impl-1',
            },
            subject_revision: 3,
            outcome_action_applied: 'block_subject',
            branch_id: null,
            artifact_ids: [],
            created_at: new Date('2026-03-23T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-qa-3', {
      request_id: 'req-qa-3',
      summary: 'Policy blocked the release packet pending legal clarification.',
      completion_state: 'full',
      decision_state: 'blocked',
      outcome_action_applied: 'block_subject',
      blockers: ['Legal clarification is required before release.'],
    } as never);

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-3',
        completion_state: 'full',
        decision_state: 'blocked',
        outcome_action_applied: 'block_subject',
        subject_revision: 3,
        subject_ref: expect.objectContaining({
          kind: 'task',
          task_id: 'task-dev-1',
          work_item_id: 'work-item-impl-1',
        }),
      }),
    );
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(insertCall?.[0]).toContain('completion_state');
    expect(insertCall?.[0]).toContain('decision_state');
    expect(insertCall?.[0]).toContain('subject_ref');
    expect(insertCall?.[0]).toContain('subject_revision');
    expect(insertCall?.[0]).toContain('outcome_action_applied');
  });

  it('rejects conflicting legacy and explicit handoff state fields', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-4',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-verify-1',
            role: 'policy-reviewer',
            stage_name: 'verification',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: {
              subject_task_id: 'task-dev-1',
              subject_work_item_id: 'work-item-impl-1',
              subject_revision: 3,
            },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
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
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: {},
            metadata: { team_name: 'delivery' },
          }],
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
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: {},
            metadata: { team_name: 'delivery' },
          }],
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
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'implementation-engineer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: { subject_task_id: 'task-architect-1', subject_revision: 1 },
            metadata: { task_kind: 'delivery', team_name: 'delivery', output_revision: 1 },
          }],
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
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-qa-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'quality-reviewer',
            stage_name: 'review',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: false,
            input: { subject_task_id: 'task-dev-1', subject_revision: 1 },
            metadata: { task_kind: 'assessment', team_name: 'delivery' },
          }],
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

  it('enqueues and dispatches an immediate workflow activation when a playbook handoff is submitted', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = { insert: vi.fn(async () => undefined) };
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'activation-1',
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: 'task-handoff-submitted:task-1:0:req-1',
            reason: 'task.handoff_submitted',
            event_type: 'task.handoff_submitted',
            payload: { task_id: 'task-1' },
            state: 'queued',
            dispatch_attempt: 0,
            dispatch_token: null,
            queued_at: new Date('2026-03-17T12:00:00Z'),
            started_at: null,
            consumed_at: null,
            completed_at: null,
            summary: null,
            error: null,
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(
      pool as never,
      logService as never,
      eventService as never,
      activationDispatchService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.arrayContaining([
        'tenant-1',
        'workflow-1',
        'task-handoff-submitted:task-1:0:req-1',
        'task.handoff_submitted',
        'task.handoff_submitted',
      ]),
    );
    expect(activationDispatchService.dispatchActivation).toHaveBeenCalledWith(
      'tenant-1',
      'activation-1',
      undefined,
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityType: 'workflow',
        entityId: 'workflow-1',
        data: expect.objectContaining({
          event_type: 'task.handoff_submitted',
          reason: 'task.handoff_submitted',
        }),
      }),
      undefined,
    );
    expect(logService.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'task.handoff.submitted',
        taskId: 'task-1',
        workItemId: 'work-item-1',
        stageName: 'implementation',
        role: 'developer',
        payload: expect.objectContaining({
          event_type: 'task.handoff_submitted',
          handoff_id: 'handoff-1',
          handoff_request_id: 'req-1',
          task_rework_count: 0,
          completion: 'full',
          sequence: 3,
        }),
      }),
    );
  });

  it('does not enqueue a new activation when an orchestrator task submits a handoff', async () => {
    const eventService = { emit: vi.fn(async () => undefined) };
    const logService = { insert: vi.fn(async () => undefined) };
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'orchestrator-task-1'),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'orchestrator',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: true,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'orchestrator',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Closed the work item and workflow state is stable.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(
      pool as never,
      logService as never,
      eventService as never,
      activationDispatchService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Closed the work item and workflow state is stable.',
      completion: 'full',
    });

    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO workflow_activations'),
      expect.anything(),
    );
    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
      }),
      expect.anything(),
    );
  });

  it('anchors orchestrator handoffs to the activation work item when the task row is workflow-scoped', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: null,
            role: 'orchestrator',
            stage_name: 'operator-approval',
            state: 'in_progress',
            rework_count: 0,
            is_orchestrator_task: true,
            input: {
              events: [{
                type: 'stage.gate.approve',
                work_item_id: 'work-item-approval-1',
                stage_name: 'operator-approval',
                payload: {
                  gate_id: 'gate-1',
                  stage_name: 'operator-approval',
                  work_item_id: 'work-item-approval-1',
                },
              }],
            },
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-anchored-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-approval-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-anchored-1',
            role: 'orchestrator',
            team_name: 'delivery',
            stage_name: 'operator-approval',
            sequence: 0,
            summary: 'Approval is complete and publication may proceed.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-23T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-anchored-1',
      summary: 'Approval is complete and publication may proceed.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ work_item_id: 'work-item-approval-1' }));
    const insertCall = pool.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO task_handoffs'),
    ) as [string, unknown[]] | undefined;
    expect(insertCall?.[1]?.[2]).toBe('work-item-approval-1');
  });

  it('serializes jsonb handoff fields before inserting them', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          role: 'developer',
          stage_name: 'implementation',
          state: 'in_progress',
          rework_count: 0,
          metadata: { team_name: 'delivery' },
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'handoff-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'req-2',
          role: 'developer',
          team_name: 'delivery',
          stage_name: 'implementation',
          sequence: 0,
          summary: 'Captured implementation handoff.',
          completion: 'full',
          changes: ['requirements summary'],
          decisions: [{ owner: 'developer' }],
          remaining_items: ['review findings'],
          blockers: ['Need human scope confirmation'],
          focus_areas: ['edge cases'],
          known_risks: ['late requirement drift'],
          successor_context: 'Keep the release scope minimal.',
          role_data: { branch: 'feature/hello-world' },
          artifact_ids: [],
          created_at: new Date('2026-03-15T12:00:00Z'),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Captured implementation handoff.',
      completion: 'full',
      changes: ['requirements summary'],
      decisions: [{ owner: 'developer' }],
      remaining_items: ['review findings'],
      blockers: ['Need human scope confirmation'],
      focus_areas: ['edge cases'],
      known_risks: ['late requirement drift'],
      successor_context: 'Keep the release scope minimal.',
      role_data: { branch: 'feature/hello-world' },
    });

    const insertParams = query.mock.calls[4][1] as unknown[];
    expect(insertParams[4]).toBe(0);
    expect(insertParams[15]).toBe(JSON.stringify(['requirements summary']));
    expect(insertParams[16]).toBe(JSON.stringify([{ owner: 'developer' }]));
    expect(insertParams[17]).toBe(JSON.stringify(['review findings']));
    expect(insertParams[18]).toBe(JSON.stringify(['Need human scope confirmation']));
    expect(insertParams[22]).toBe(
      JSON.stringify({
        branch: 'feature/hello-world',
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 1,
      }),
    );
  });

  it('treats late handoff activation enqueue as a no-op once the workflow is already completed', async () => {
    const logService = {
      insert: vi.fn(async () => undefined),
    };
    const eventService = {
      emit: vi.fn(async () => undefined),
    };
    const activationDispatchService = {
      dispatchActivation: vi.fn(async () => 'activation-task'),
    };
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'completed',
            rework_count: 0,
            metadata: {},
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            role: 'developer',
            team_name: null,
            stage_name: 'implementation',
            sequence: 3,
            request_id: 'req-1',
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ playbook_id: 'playbook-1' }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'activation-noop',
            workflow_id: 'workflow-1',
            activation_id: null,
            request_id: 'task-handoff-submitted:task-1:0:req-1',
            reason: 'task.handoff_submitted',
            event_type: 'task.handoff_submitted',
            payload: { task_id: 'task-1' },
            state: 'completed',
            dispatch_attempt: 0,
            dispatch_token: null,
            queued_at: new Date('2026-03-17T12:00:00Z'),
            started_at: null,
            consumed_at: new Date('2026-03-17T12:00:00Z'),
            completed_at: new Date('2026-03-17T12:00:00Z'),
            summary: 'Ignored activation because workflow is already completed.',
            error: null,
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(
      pool as never,
      logService as never,
      eventService as never,
      activationDispatchService as never,
    );

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(activationDispatchService.dispatchActivation).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workflow.activation_queued',
        entityId: 'workflow-1',
      }),
      undefined,
    );
  });

  it('redacts secret-like handoff content before persistence and in returned rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          role: 'developer',
          stage_name: 'implementation',
          state: 'in_progress',
          rework_count: 0,
          metadata: { team_name: 'delivery' },
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'handoff-secret-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          task_rework_count: 0,
          request_id: 'req-secret-1',
          role: 'developer',
          team_name: 'delivery',
          stage_name: 'implementation',
          sequence: 0,
          summary: 'sk-runtime-secret',
          completion: 'full',
          changes: [{ api_key: 'sk-runtime-secret' }],
          decisions: [{ authorization: 'Bearer handoff-secret' }],
          remaining_items: ['sk-runtime-secret'],
          blockers: [{ token: 'sk-runtime-secret' }],
          focus_areas: ['sk-runtime-secret'],
          known_risks: ['Bearer handoff-secret'],
          successor_context: 'Bearer handoff-secret',
          role_data: { api_key: 'sk-runtime-secret' },
          artifact_ids: [],
          created_at: new Date('2026-03-15T12:00:00Z'),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-secret-1',
      summary: 'sk-runtime-secret',
      completion: 'full',
      changes: [{ api_key: 'sk-runtime-secret' }],
      decisions: [{ authorization: 'Bearer handoff-secret' }],
      remaining_items: ['sk-runtime-secret'],
      blockers: [{ token: 'sk-runtime-secret' }],
      focus_areas: ['sk-runtime-secret'],
      known_risks: ['Bearer handoff-secret'],
      successor_context: 'Bearer handoff-secret',
      role_data: { api_key: 'sk-runtime-secret' },
    });

    const insertParams = query.mock.calls[4][1] as unknown[];
    expect(insertParams[10]).toBe('redacted://handoff-secret');
    expect(insertParams[15]).toBe(JSON.stringify([{ api_key: 'redacted://handoff-secret' }]));
    expect(insertParams[16]).toBe(
      JSON.stringify([{ authorization: 'redacted://handoff-secret' }]),
    );
    expect(insertParams[17]).toBe(JSON.stringify(['redacted://handoff-secret']));
    expect(insertParams[18]).toBe(JSON.stringify([{ token: 'redacted://handoff-secret' }]));
    expect(insertParams[19]).toEqual(['redacted://handoff-secret']);
    expect(insertParams[20]).toEqual(['redacted://handoff-secret']);
    expect(insertParams[21]).toBe('redacted://handoff-secret');
    expect(insertParams[22]).toBe(
      JSON.stringify({
        api_key: 'redacted://handoff-secret',
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 1,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        summary: 'redacted://handoff-secret',
        changes: [{ api_key: 'redacted://handoff-secret' }],
        decisions: [{ authorization: 'redacted://handoff-secret' }],
        remaining_items: ['redacted://handoff-secret'],
        blockers: [{ token: 'redacted://handoff-secret' }],
        focus_areas: ['redacted://handoff-secret'],
        known_risks: ['redacted://handoff-secret'],
        successor_context: 'redacted://handoff-secret',
        role_data: { api_key: 'redacted://handoff-secret' },
      }),
    );
  });

  it('returns the existing handoff for an idempotent request replay', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 1,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      focus_areas: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', request_id: 'req-1' }));
  });

  it('returns the persisted handoff when a completed task replays the same request_id with stale payload', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'completed',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 1,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Different summary',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', request_id: 'req-1' }));
  });

  it('returns the persisted handoff when a non-editable task attempt already satisfies the handoff contract', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'output_pending_assessment',
            rework_count: 2,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 2,
            request_id: 'req-current',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 2,
            summary: 'Persisted handoff already recorded.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['handoff'],
            known_risks: [],
            successor_context: 'Use the stored handoff.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 3,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-16T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-stale-retry',
      task_rework_count: 2,
      summary: 'New stale payload after the attempt already settled.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-2', request_id: 'req-current' }));
  });

  it('reuses the current task-attempt handoff when a stale request_id points at an earlier attempt', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'output_pending_assessment',
            rework_count: 3,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-r2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 2,
            request_id: 'req-r2',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 2,
            summary: 'Persisted handoff for revision 2.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['delivery'],
            known_risks: [],
            successor_context: 'Review revision 2.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 3,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-16T12:00:00Z'),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-r3',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 3,
            request_id: 'req-r3',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Persisted handoff for revision 3.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['delivery'],
            known_risks: [],
            successor_context: 'Review revision 3.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 4,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-17T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-r2',
      task_rework_count: 3,
      summary: 'Stale retry after revision 3 already persisted.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-r3', request_id: 'req-r3' }));
  });

  it('reuses the current task-attempt handoff for an active task when a stale request_id points at an earlier attempt', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 3,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-r2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 2,
            request_id: 'req-r2',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 2,
            summary: 'Persisted handoff for revision 2.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['delivery'],
            known_risks: [],
            successor_context: 'Review revision 2.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 3,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-16T12:00:00Z'),
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-r3',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 3,
            request_id: 'req-r3',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Persisted handoff for revision 3.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['delivery'],
            known_risks: [],
            successor_context: 'Review revision 3.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 4,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-17T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-r2',
      task_rework_count: 3,
      summary: 'Stale retry after revision 3 already persisted while the task stayed active.',
      completion: 'full',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-r3', request_id: 'req-r3' }));
  });

  it('returns structured recovery guidance when an active task reuses a request_id with a different handoff payload', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            task_rework_count: 0,
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {
              task_kind: 'delivery',
              subject_task_id: 'task-1',
              subject_work_item_id: 'work-item-1',
              subject_revision: 1,
            },
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    const error = await service.submitTaskHandoff('tenant-1', 'task-1', {
        request_id: 'req-1',
        summary: 'Different summary',
        completion: 'full',
      })
      .then(() => null)
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error?.message).toBe(
      'submit_handoff replay conflicted with the persisted handoff for this task attempt',
    );
    expect(error?.details).toMatchObject({
      reason_code: 'submit_handoff_replay_conflict',
      recovery_hint: 'inspect_persisted_handoff_or_use_new_request_id',
      recoverable: true,
      conflict_source: 'same_request_id_different_payload',
      task_contract_satisfied_by_persisted_handoff: false,
      conflicting_request_ids: {
        submitted_request_id: 'req-1',
        persisted_request_id: 'req-1',
      },
      existing_handoff: {
        id: 'handoff-1',
        request_id: 'req-1',
        task_id: 'task-1',
        task_rework_count: 0,
      },
    });
    expect(error?.details?.replay_conflict_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'summary',
        operator_message: expect.stringContaining('Persisted handoff summary'),
      }),
    ]));
    expect(error?.details?.escalation_guidance).toMatchObject({
      context_summary: expect.stringContaining('submit_handoff request_id "req-1"'),
      work_so_far: expect.stringContaining('Different summary'),
    });
    expect(error?.details?.suggested_next_actions).toEqual(expect.arrayContaining([
        expect.objectContaining({
          action_code: 'inspect_persisted_handoff',
          target_type: 'handoff',
          target_id: 'handoff-1',
        }),
        expect.objectContaining({
          action_code: 'resubmit_handoff_with_new_request_id',
          target_type: 'task',
          target_id: 'task-1',
        }),
      ]));
  });

  it('loads the predecessor handoff for a task-scoped chain', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'reviewer',
            stage_name: 'review',
            state: 'in_progress',
            rework_count: 0,
            metadata: {},
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'sk-predecessor-secret',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: 'Bearer predecessor-secret',
            role_data: { api_key: 'sk-predecessor-secret' },
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
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
            rows: [{
              id: 'task-release-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-release',
              role: 'product-manager',
              stage_name: 'release',
              state: 'in_progress',
              rework_count: 0,
              metadata: {},
            }],
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
              id: 'handoff-qa-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              work_item_id: 'work-item-verification',
              task_id: 'task-qa-1',
              request_id: 'req-qa-1',
              role: 'qa',
              team_name: null,
              stage_name: 'verification',
              sequence: 0,
              summary: 'QA validated the branch successfully.',
              completion: 'full',
              changes: [],
              decisions: ['Release can proceed'],
              remaining_items: [],
              blockers: [],
              focus_areas: ['Human release approval'],
              known_risks: [],
              successor_context: 'Use the QA evidence for release approval.',
              role_data: {},
              artifact_ids: [],
              created_at: new Date('2026-03-16T12:00:00Z'),
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

  it('updates the existing handoff for the same active assessment task attempt when the payload changes', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'security-review',
            stage_name: 'implementation',
            state: 'in_progress',
            rework_count: 0,
            metadata: { team_name: 'delivery', task_kind: 'assessment' },
          }],
          rowCount: 1,
        })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'handoff-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          task_rework_count: 0,
          request_id: 'req-1',
          role: 'security-review',
          team_name: 'delivery',
          stage_name: 'implementation',
          sequence: 0,
          summary: 'Interim review note.',
          completion: 'full',
          resolution: 'request_changes',
          changes: [],
          decisions: [],
          remaining_items: ['confirm tests'],
          blockers: [],
          focus_areas: [],
          known_risks: [],
          successor_context: null,
          role_data: {},
          artifact_ids: [],
          created_at: new Date('2026-03-15T12:00:00Z'),
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'handoff-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          task_rework_count: 0,
          request_id: 'req-2',
          role: 'security-review',
          team_name: 'delivery',
          stage_name: 'implementation',
          sequence: 0,
          summary: 'Approved after verification.',
          completion: 'full',
          resolution: 'approved',
          changes: ['Ran Hello World command.'],
          decisions: ['APPROVED'],
          remaining_items: [],
          blockers: [],
          focus_areas: ['handoff to qa'],
          known_risks: [],
          successor_context: 'QA should confirm tests and release posture.',
          role_data: { verdict: 'APPROVED' },
          artifact_ids: [],
          created_at: new Date('2026-03-15T12:00:00Z'),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Approved after verification.',
      completion: 'full',
      resolution: 'approved',
      changes: ['Ran Hello World command.'],
      decisions: ['APPROVED'],
      focus_areas: ['handoff to qa'],
      successor_context: 'QA should confirm tests and release posture.',
      role_data: { verdict: 'APPROVED' },
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 'handoff-1', request_id: 'req-2', completion: 'full' }),
    );
    expect(query.mock.calls[3]?.[0]).toContain('UPDATE task_handoffs');
  });

  it('requires a structured handoff before completing a workflow-linked task', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        is_orchestrator_task: false,
        role: 'developer',
        input: {},
        metadata: { task_kind: 'delivery' },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Task requires a structured handoff before completion',
      details: {
        reason_code: 'required_structured_handoff',
        recovery_hint: 'submit_required_handoff',
        recoverable: true,
        recovery: {
          status: 'action_required',
          reason: 'required_structured_handoff',
          action: 'submit_required_handoff',
        },
      },
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM task_handoffs'),
      ['tenant-1', 'task-1', 0],
    );
  });

  it('accepts a matching current-attempt structured handoff before completion', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'handoff-1' }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        is_orchestrator_task: false,
        role: 'developer',
        rework_count: 1,
        input: {},
        metadata: { task_kind: 'delivery' },
      }),
    ).resolves.toBeUndefined();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM task_handoffs'),
      ['tenant-1', 'task-1', 1],
    );
  });

  it('does not require a structured handoff for standalone tasks outside workflow control', async () => {
    const pool = {
      query: vi.fn(),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-standalone',
        workflow_id: null,
        role: 'developer',
        input: {},
        metadata: {},
      }),
    ).resolves.toBeUndefined();

    expect(pool.query).not.toHaveBeenCalled();
  });
});
