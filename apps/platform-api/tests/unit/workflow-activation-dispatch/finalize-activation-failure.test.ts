import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/safetynet/logging.js', () => ({
  logSafetynetTriggered: vi.fn(),
}));

import { logSafetynetTriggered } from '../../../src/services/safetynet/logging.js';
import { PLATFORM_ACTIVATION_STALE_CALLBACK_SUPPRESSION_ID } from '../../../src/services/safetynet/registry.js';
import { WorkflowActivationDispatchService } from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('skips duplicate failure callbacks after an activation was already finalized', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 0, rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        error: { message: 'Already handled' },
      },
      'failed',
      client as never,
    );

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('immediately retries the next queued activation after a failed orchestrator activation requeues the batch', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'queued\'')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            'Orchestrator activation failed',
            { message: 'Orchestrator activation failed' },
          ]);
          return {
            rowCount: 2,
            rows: [
              {
                id: 'activation-1',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: null,
                request_id: 'req-1',
                reason: 'task.completed',
                event_type: 'task.completed',
                payload: {},
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:00Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Orchestrator activation failed',
                error: { message: 'Orchestrator activation failed' },
              },
              {
                id: 'activation-2',
                tenant_id: 'tenant-1',
                workflow_id: 'workflow-1',
                activation_id: null,
                request_id: 'req-2',
                reason: 'work_item.updated',
                event_type: 'work_item.updated',
                payload: {},
                state: 'queued',
                queued_at: new Date('2026-03-11T00:00:05Z'),
                started_at: null,
                consumed_at: null,
                completed_at: null,
                summary: 'Orchestrator activation failed',
                error: { message: 'Orchestrator activation failed' },
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('activation_id IS NULL')) {
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-retry');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
      },
      'failed',
      client as never,
    );

    expect(dispatchSpy).toHaveBeenCalledWith('tenant-1', 'activation-1', client, {
      ignoreDelay: true,
    });
  });

  it('parks failed orchestrator activations that require operator action instead of redispatching them', async () => {
    const blockedError = {
      message: 'OAuth session expired. An admin must reconnect on the LLM Providers page.',
      recovery: {
        status: 'operator_action_required',
        reason: 'provider_reauth_required',
        provider_id: 'provider-oauth',
      },
    };
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('SET state = \'queued\'')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            'OAuth session expired. An admin must reconnect on the LLM Providers page.',
            blockedError,
          ]);
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-1',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-1',
              reason: 'work_item.updated',
              event_type: 'work_item.updated',
              payload: { work_item_id: 'wi-1' },
              state: 'queued',
              queued_at: new Date('2026-03-11T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: 'OAuth session expired. An admin must reconnect on the LLM Providers page.',
              error: blockedError,
            }],
          };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-retry');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        error: blockedError,
      },
      'failed',
      client as never,
    );

    expect(eventService.emit).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('ignores queued activations that are parked for operator action', async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        expect(sql).toContain("COALESCE(wa.error->'recovery'->>'status', '') <> 'operator_action_required'");
        return { rowCount: 0, rows: [] };
      }),
    };

    const service = new WorkflowActivationDispatchService({
      pool: pool as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });

    await expect(service.dispatchQueuedActivations()).resolves.toBe(0);
  });

  it('ignores stale completion callbacks when a replacement orchestrator task is already active', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("AND activation_id = $3") && sql.includes("state = 'processing'")) {
          expect(params).toEqual(['tenant-1', 'workflow-1', 'activation-1']);
          return { rowCount: 1, rows: [{ id: 'activation-1' }] };
        }
        if (sql.includes('FROM tasks') && sql.includes('activation_id = $3') && sql.includes('id <> $5::uuid')) {
          expect(params).toEqual([
            'tenant-1',
            'workflow-1',
            'activation-1',
            ['pending', 'ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'],
            'task-old',
          ]);
          return { rowCount: 1, rows: [{ '?column?': 1 }] };
        }
        if (sql.includes('SET state = \'completed\'')) {
          throw new Error('completion update should not run for stale callbacks');
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const eventService = { emit: vi.fn(async () => undefined) };
    const service = new WorkflowActivationDispatchService({
      pool: { query: vi.fn(), connect: vi.fn() } as never,
      eventService: eventService as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    const dispatchSpy = vi.spyOn(service, 'dispatchActivation').mockResolvedValue('task-next');

    await service.finalizeActivationForTask(
      'tenant-1',
      {
        id: 'task-old',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        is_orchestrator_task: true,
        output: { summary: 'Late callback from stale task' },
      },
      'completed',
      client as never,
    );

    expect(eventService.emit).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(logSafetynetTriggered).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PLATFORM_ACTIVATION_STALE_CALLBACK_SUPPRESSION_ID,
      }),
      'platform suppressed a stale orchestrator activation callback because a replacement orchestrator task is already active',
      expect.objectContaining({
        tenant_id: 'tenant-1',
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        task_id: 'task-old',
      }),
    );
  });
});
