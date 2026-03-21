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
            review_focus: ['error handling'],
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
      review_focus: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        sequence: 3,
        review_focus: ['error handling'],
      }),
    );
  });

  it('allows resolution on review-linked verification handoffs', async () => {
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
            input: { reviewed_task_id: 'task-dev-1' },
            metadata: { task_type: 'test', team_name: 'delivery' },
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
            review_focus: ['Verification command contract'],
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
      review_focus: ['Verification command contract'],
      successor_context: 'Check the repository test command before approving.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-qa-1',
        resolution: 'request_changes',
        stage_name: 'verification',
      }),
    );
  });

  it('requires resolution on successful review-linked handoffs', async () => {
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
            input: { reviewed_task_id: 'task-dev-1' },
            metadata: { task_type: 'test', team_name: 'delivery' },
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
      new ValidationError('resolution is required on full review-linked task handoffs'),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('allows blocked review-linked handoffs without resolution', async () => {
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
            input: { reviewed_task_id: 'task-dev-1' },
            metadata: { task_type: 'test', team_name: 'delivery' },
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
            review_focus: [],
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

  it('rejects resolution on ordinary non-review-linked tasks', async () => {
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
    })).rejects.toThrowError(new ValidationError('resolution is only allowed on review-linked task handoffs'));

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
            review_focus: ['error handling'],
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
      review_focus: ['error handling'],
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
            review_focus: [],
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
          review_focus: ['edge cases'],
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
      review_focus: ['edge cases'],
      known_risks: ['late requirement drift'],
      successor_context: 'Keep the release scope minimal.',
      role_data: { branch: 'feature/hello-world' },
    });

    const insertParams = query.mock.calls[4][1] as unknown[];
    expect(insertParams[4]).toBe(0);
    expect(insertParams[13]).toBe(JSON.stringify(['requirements summary']));
    expect(insertParams[14]).toBe(JSON.stringify([{ owner: 'developer' }]));
    expect(insertParams[15]).toBe(JSON.stringify(['review findings']));
    expect(insertParams[16]).toBe(JSON.stringify(['Need human scope confirmation']));
    expect(insertParams[20]).toBe(JSON.stringify({ branch: 'feature/hello-world' }));
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
            review_focus: ['error handling'],
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
      review_focus: ['error handling'],
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
          review_focus: ['sk-runtime-secret'],
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
      review_focus: ['sk-runtime-secret'],
      known_risks: ['Bearer handoff-secret'],
      successor_context: 'Bearer handoff-secret',
      role_data: { api_key: 'sk-runtime-secret' },
    });

    const insertParams = query.mock.calls[4][1] as unknown[];
    expect(insertParams[10]).toBe('redacted://handoff-secret');
    expect(insertParams[13]).toBe(JSON.stringify([{ api_key: 'redacted://handoff-secret' }]));
    expect(insertParams[14]).toBe(
      JSON.stringify([{ authorization: 'redacted://handoff-secret' }]),
    );
    expect(insertParams[15]).toBe(JSON.stringify(['redacted://handoff-secret']));
    expect(insertParams[16]).toBe(JSON.stringify([{ token: 'redacted://handoff-secret' }]));
    expect(insertParams[17]).toEqual(['redacted://handoff-secret']);
    expect(insertParams[18]).toEqual(['redacted://handoff-secret']);
    expect(insertParams[19]).toBe('redacted://handoff-secret');
    expect(insertParams[20]).toBe(
      JSON.stringify({ api_key: 'redacted://handoff-secret' }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        summary: 'redacted://handoff-secret',
        changes: [{ api_key: 'redacted://handoff-secret' }],
        decisions: [{ authorization: 'redacted://handoff-secret' }],
        remaining_items: ['redacted://handoff-secret'],
        blockers: [{ token: 'redacted://handoff-secret' }],
        review_focus: ['redacted://handoff-secret'],
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
            review_focus: ['error handling'],
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
      review_focus: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', request_id: 'req-1' }));
  });

  it('rejects a replay when the existing handoff payload differs', async () => {
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
            review_focus: ['error handling'],
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

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-1', {
        request_id: 'req-1',
        summary: 'Different summary',
        completion: 'full',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
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
            review_focus: [],
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
              review_focus: ['Human release approval'],
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

  it('updates the existing handoff for the same active custom review task attempt when the payload changes', async () => {
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
            metadata: { team_name: 'delivery', task_type: 'review' },
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
          review_focus: [],
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
          review_focus: ['handoff to qa'],
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
      review_focus: ['handoff to qa'],
      successor_context: 'QA should confirm tests and release posture.',
      role_data: { verdict: 'APPROVED' },
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 'handoff-1', request_id: 'req-2', completion: 'full' }),
    );
    expect(query.mock.calls[3]?.[0]).toContain('UPDATE task_handoffs');
  });

  it('requires a structured handoff before completion when the playbook mandates it', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              process_instructions: 'Developer implements and reviewer reviews.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        role: 'developer',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires a fresh structured handoff for the current rework iteration before completion', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              process_instructions: 'Developer implements and reviewer reviews.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
            },
          }],
          rowCount: 1,
        })
        .mockImplementationOnce(async (sql: string) => {
          if (sql.includes('task_rework_count')) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [{ id: 'handoff-0' }], rowCount: 1 };
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        role: 'developer',
        rework_count: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
