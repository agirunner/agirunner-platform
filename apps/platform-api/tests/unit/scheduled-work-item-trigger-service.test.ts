import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { ScheduledWorkItemTriggerService } from '../../src/services/scheduled-work-item-trigger-service.js';

describe('ScheduledWorkItemTriggerService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let eventService: { emit: ReturnType<typeof vi.fn> };
  let workflowService: { createWorkflowWorkItem: ReturnType<typeof vi.fn> };
  let service: ScheduledWorkItemTriggerService;

  beforeEach(() => {
    pool = { query: vi.fn() };
    eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    workflowService = { createWorkflowWorkItem: vi.fn() };
    service = new ScheduledWorkItemTriggerService(pool as never, eventService as never, workflowService as never);
  });

  it('creates a scheduled trigger with validated defaults', async () => {
    const trigger = buildTriggerRow();
    pool.query
      .mockResolvedValueOnce({ rows: [buildWorkflowScopeRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 });

    const result = await service.createTrigger(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k-admin',
      },
      {
        name: 'Daily triage',
        source: 'system.schedule',
        workflow_id: 'workflow-1',
        cadence_minutes: 60,
        defaults: {
          title: 'Run inbox triage',
          owner_role: 'triager',
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'trigger-1',
        cadence_minutes: 60,
        workflow_id: 'workflow-1',
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.created',
        data: expect.objectContaining({
          trigger_id: 'trigger-1',
          trigger_kind: 'schedule',
        }),
      }),
    );
  });

  it('fires due triggers through work-item idempotency and records the invocation', async () => {
    const trigger = buildTriggerRow();
    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    workflowService.createWorkflowWorkItem.mockResolvedValue({ id: 'wi-1' });

    const result = await service.fireDueTriggers(new Date('2026-03-11T09:00:00Z'));

    expect(result).toEqual({
      claimed: 1,
      fired: 1,
      duplicates: 0,
      failed: 0,
    });
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'scheduled_trigger',
        keyPrefix: 'trigger:trigger-1',
      }),
      'workflow-1',
      expect.objectContaining({
        request_id: 'trigger:trigger-1:2026-03-11T09:00:00.000Z',
        title: 'Run inbox triage',
        stage_name: 'implementation',
        column_id: 'in_progress',
        owner_role: 'triager',
        priority: 'critical',
        metadata: expect.objectContaining({
          source_kind: 'schedule',
          trigger: expect.objectContaining({
            trigger_id: 'trigger-1',
            trigger_kind: 'schedule',
            scheduled_for: '2026-03-11T09:00:00.000Z',
          }),
        }),
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.fired',
        data: expect.objectContaining({
          work_item_id: 'wi-1',
          trigger_kind: 'schedule',
        }),
      }),
    );
  });

  it('treats an existing scheduled invocation as duplicate and does not create another work item', async () => {
    const trigger = buildTriggerRow();
    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ work_item_id: 'wi-existing' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await service.fireDueTriggers(new Date('2026-03-11T09:00:00Z'));

    expect(result).toEqual({
      claimed: 1,
      fired: 0,
      duplicates: 1,
      failed: 0,
    });
    expect(workflowService.createWorkflowWorkItem).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger.fired' }));
  });

  it('rejects scheduled triggers that target a non-playbook workflow', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ project_id: 'project-1', playbook_id: null, definition: null }],
      rowCount: 1,
    });

    await expect(() => service.createTrigger(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k-admin',
      },
      {
        name: 'Daily triage',
        source: 'system.schedule',
        workflow_id: 'workflow-1',
        cadence_minutes: 60,
        defaults: { title: 'Run inbox triage' },
      },
    )).rejects.toThrowError(new ValidationError('Scheduled work item triggers must target a playbook workflow'));
  });

  it('rejects scheduled triggers with an invalid default stage', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [buildWorkflowScopeRow()],
      rowCount: 1,
    });

    await expect(() => service.createTrigger(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k-admin',
      },
      {
        name: 'Daily triage',
        source: 'system.schedule',
        workflow_id: 'workflow-1',
        cadence_minutes: 60,
        defaults: {
          title: 'Run inbox triage',
          stage_name: 'qa',
        },
      },
    )).rejects.toThrowError(new ValidationError("Scheduled trigger default stage_name must match a playbook stage"));
  });

  it('rejects scheduled triggers with an invalid default column', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [buildWorkflowScopeRow()],
      rowCount: 1,
    });

    await expect(() => service.createTrigger(
      {
        id: 'key-1',
        tenantId: 'tenant-1',
        scope: 'admin',
        ownerType: 'user',
        ownerId: 'user-1',
        keyPrefix: 'k-admin',
      },
      {
        name: 'Daily triage',
        source: 'system.schedule',
        workflow_id: 'workflow-1',
        cadence_minutes: 60,
        defaults: {
          title: 'Run inbox triage',
          column_id: 'qa',
        },
      },
    )).rejects.toThrowError(new ValidationError("Scheduled trigger default column_id must match a playbook board column"));
  });
});

function buildTriggerRow() {
  return {
    id: 'trigger-1',
    tenant_id: 'tenant-1',
    name: 'Daily triage',
    source: 'system.schedule',
    project_id: 'project-1',
    workflow_id: 'workflow-1',
    cadence_minutes: 60,
    defaults: {
      title: 'Run inbox triage',
      owner_role: 'triager',
      stage_name: 'implementation',
      column_id: 'in_progress',
      priority: 'critical',
      metadata: {
        source_kind: 'schedule',
      },
    },
    is_active: true,
    last_fired_at: null,
    next_fire_at: new Date('2026-03-11T09:00:00Z'),
    lease_token: 'lease-1',
    lease_expires_at: new Date('2026-03-11T09:00:30Z'),
    created_at: new Date('2026-03-11T08:00:00Z'),
    updated_at: new Date('2026-03-11T08:00:00Z'),
  };
}

function buildWorkflowScopeRow() {
  return {
    project_id: 'project-1',
    playbook_id: 'playbook-1',
    definition: {
      roles: ['triager'],
      board: {
        columns: [
          { id: 'backlog', label: 'Backlog' },
          { id: 'in_progress', label: 'In Progress' },
        ],
      },
      stages: [
        { name: 'triage', goal: 'Triage new work' },
        { name: 'implementation', goal: 'Implement fixes' },
      ],
    },
  };
}
