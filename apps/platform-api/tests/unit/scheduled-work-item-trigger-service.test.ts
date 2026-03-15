import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { ScheduledWorkItemTriggerService } from '../../src/services/scheduled-work-item-trigger-service.js';

describe('ScheduledWorkItemTriggerService', () => {
  let pool: { query: ReturnType<typeof vi.fn> };
  let eventService: { emit: ReturnType<typeof vi.fn> };
  let workflowService: { createWorkflowWorkItem: ReturnType<typeof vi.fn> };
  let service: ScheduledWorkItemTriggerService;

  beforeEach(() => {
    vi.useFakeTimers();
    pool = { query: vi.fn() };
    eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    workflowService = { createWorkflowWorkItem: vi.fn() };
    service = new ScheduledWorkItemTriggerService(pool as never, eventService as never, workflowService as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a project scheduled trigger with canonical source and sanitized defaults', async () => {
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
        workflow_id: 'workflow-1',
        schedule_type: 'interval',
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
        source: 'project.schedule',
        schedule_type: 'interval',
        cadence_minutes: 60,
        daily_time: null,
        timezone: null,
        workflow_id: 'workflow-1',
        defaults: {
          title: 'Run inbox triage',
          stage_name: 'implementation',
          column_id: 'in_progress',
          priority: 'critical',
          metadata: {
            source_kind: 'schedule',
          },
        },
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.created',
        data: expect.objectContaining({
          trigger_id: 'trigger-1',
          source: 'project.schedule',
          trigger_kind: 'schedule',
        }),
      }),
    );
  });

  it('creates a daily schedule and computes the next fire from the local wall clock time', async () => {
    vi.setSystemTime(new Date('2026-03-11T12:15:00Z'));
    pool.query
      .mockResolvedValueOnce({ rows: [buildWorkflowScopeRow()], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          buildTriggerRow({
            schedule_type: 'daily_time',
            cadence_minutes: null,
            daily_time: '09:30',
            timezone: 'America/New_York',
            next_fire_at: new Date('2026-03-11T13:30:00Z'),
          }),
        ],
        rowCount: 1,
      });

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
        name: 'Morning triage',
        source: 'project.schedule',
        workflow_id: 'workflow-1',
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        timezone: 'America/New_York',
        defaults: {
          title: 'Run inbox triage',
        },
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        schedule_type: 'daily_time',
        daily_time: '09:30',
        timezone: 'America/New_York',
        next_fire_at: '2026-03-11T13:30:00.000Z',
      }),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO scheduled_work_item_triggers'),
      expect.arrayContaining([
        'tenant-1',
        'Morning triage',
        'project.schedule',
        'project-1',
        'workflow-1',
        'daily_time',
        null,
        '09:30',
        'America/New_York',
      ]),
    );
  });

  it('fires due interval triggers through work-item idempotency and records the invocation', async () => {
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
    expect(workflowService.createWorkflowWorkItem.mock.calls[0]?.[2]).not.toHaveProperty('owner_role');
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

  it('advances a daily schedule to the next local wall clock time after firing', async () => {
    const trigger = buildTriggerRow({
      schedule_type: 'daily_time',
      cadence_minutes: null,
      daily_time: '09:30',
      timezone: 'America/New_York',
      next_fire_at: new Date('2026-03-11T13:30:00Z'),
    });
    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    workflowService.createWorkflowWorkItem.mockResolvedValue({ id: 'wi-1' });

    await service.fireDueTriggers(new Date('2026-03-11T13:30:00Z'));

    expect(pool.query.mock.calls).toContainEqual([
      expect.stringContaining('UPDATE scheduled_work_item_triggers'),
      ['tenant-1', 'trigger-1', trigger.next_fire_at, new Date('2026-03-12T13:30:00Z'), 'lease-1'],
    ]);
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

  it('redacts secret-bearing scheduled trigger defaults on public reads', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          ...buildTriggerRow(),
          defaults: {
            title: 'Run inbox triage',
            metadata: {
              api_key: 'plain-secret',
              secret_ref: 'secret:SCHEDULE_TRIGGER_SECRET',
            },
          },
        },
      ],
      rowCount: 1,
    });

    const result = await service.listTriggers('tenant-1');

    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 'trigger-1',
          defaults: {
            title: 'Run inbox triage',
            metadata: {
              api_key: 'redacted://trigger-secret',
              secret_ref: 'redacted://trigger-secret',
            },
          },
        }),
      ],
    });
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
        source: 'project.schedule',
        workflow_id: 'workflow-1',
        schedule_type: 'interval',
        cadence_minutes: 60,
        defaults: { title: 'Run inbox triage' },
      },
    )).rejects.toThrowError(new ValidationError('Scheduled work item triggers must target a playbook workflow'));
  });

  it('rejects daily schedules without a timezone', async () => {
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
        name: 'Morning triage',
        source: 'project.schedule',
        workflow_id: 'workflow-1',
        schedule_type: 'daily_time',
        cadence_minutes: null,
        daily_time: '09:30',
        defaults: { title: 'Run inbox triage' },
      },
    )).rejects.toThrowError(new ValidationError('timezone is required for daily_time schedules'));
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
        source: 'project.schedule',
        workflow_id: 'workflow-1',
        schedule_type: 'interval',
        cadence_minutes: 60,
        defaults: {
          title: 'Run inbox triage',
          stage_name: 'qa',
        },
      },
    )).rejects.toThrowError(new ValidationError('Scheduled trigger default stage_name must match a playbook stage'));
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
        source: 'project.schedule',
        workflow_id: 'workflow-1',
        schedule_type: 'interval',
        cadence_minutes: 60,
        defaults: {
          title: 'Run inbox triage',
          column_id: 'qa',
        },
      },
    )).rejects.toThrowError(new ValidationError('Scheduled trigger default column_id must match a playbook board column'));
  });
});

function buildTriggerRow(overrides: Partial<{
  schedule_type: 'interval' | 'daily_time';
  cadence_minutes: number | null;
  daily_time: string | null;
  timezone: string | null;
  next_fire_at: Date;
  defaults: Record<string, unknown>;
}> = {}) {
  return {
    id: 'trigger-1',
    tenant_id: 'tenant-1',
    name: 'Daily triage',
    source: 'project.schedule',
    project_id: 'project-1',
    workflow_id: 'workflow-1',
    schedule_type: overrides.schedule_type ?? 'interval',
    cadence_minutes: overrides.cadence_minutes ?? 60,
    daily_time: overrides.daily_time ?? null,
    timezone: overrides.timezone ?? null,
    defaults: overrides.defaults ?? {
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
    next_fire_at: overrides.next_fire_at ?? new Date('2026-03-11T09:00:00Z'),
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
