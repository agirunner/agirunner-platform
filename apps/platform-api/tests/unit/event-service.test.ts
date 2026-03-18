import { describe, expect, it, vi } from 'vitest';

import { EventService } from '../../src/services/event-service.js';

describe('EventService', () => {
  it('adds stable workflow filters and timeline metadata for activation-backed child workflow events', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const service = new EventService({ query } as never);

    await service.emit({
      tenantId: 'tenant-1',
      type: 'workflow.activation_queued',
      entityType: 'workflow',
      entityId: 'workflow-1',
      actorType: 'system',
      actorId: 'dispatcher',
      data: {
        activation_id: 'activation-1',
        event_type: 'child_workflow.completed',
        child_workflow_id: 'workflow-child-1',
      },
    });

    const payload = query.mock.calls[0]?.[1]?.[6] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        child_workflow_id: 'workflow-child-1',
        timeline_category: 'child_workflow',
        timeline_family: 'activation',
        timeline_chain: 'workflow-child-1',
      }),
    );
  });

  it('categorizes direct child workflow events as child-workflow timeline families', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const service = new EventService({ query } as never);

    await service.emit({
      tenantId: 'tenant-1',
      type: 'child_workflow.completed',
      entityType: 'workflow',
      entityId: 'workflow-child-1',
      actorType: 'system',
      actorId: 'workflow_state_deriver',
      data: {
        parent_workflow_id: 'workflow-parent-1',
        child_workflow_id: 'workflow-child-1',
        child_workflow_state: 'completed',
      },
    });

    const payload = query.mock.calls[0]?.[1]?.[6] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-child-1',
        parent_workflow_id: 'workflow-parent-1',
        child_workflow_id: 'workflow-child-1',
        timeline_category: 'child_workflow',
        timeline_family: 'child_workflow',
        timeline_chain: 'workflow-child-1',
      }),
    );
  });

  it('normalizes task and gate identifiers for escalation and review events', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const service = new EventService({ query } as never);

    await service.emit({
      tenantId: 'tenant-1',
      type: 'task.escalation_task_created',
      entityType: 'task',
      entityId: 'task-1',
      actorType: 'agent',
      actorId: 'agent-1',
      data: {
        escalation_task_id: 'task-esc-1',
        source_task_id: 'task-1',
      },
    });
    await service.emit({
      tenantId: 'tenant-1',
      type: 'stage.gate.approve',
      entityType: 'gate',
      entityId: 'gate-1',
      actorType: 'admin',
      actorId: 'admin-1',
      data: {
        stage_name: 'review',
      },
    });

    const escalationPayload = query.mock.calls[0]?.[1]?.[6] as Record<string, unknown>;
    const gatePayload = query.mock.calls[1]?.[1]?.[6] as Record<string, unknown>;

    expect(escalationPayload).toEqual(
      expect.objectContaining({
        task_id: 'task-1',
        timeline_category: 'escalation',
        timeline_family: 'task',
        timeline_chain: 'task-1',
      }),
    );
    expect(gatePayload).toEqual(
      expect.objectContaining({
        gate_id: 'gate-1',
        timeline_category: 'gate',
        timeline_family: 'gate',
        timeline_chain: 'review',
      }),
    );
  });

  it('catches embedded bearer and api key tokens within prose event values', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const service = new EventService({ query } as never);

    await service.emit({
      tenantId: 'tenant-1',
      type: 'task.state_changed',
      entityType: 'task',
      entityId: 'task-1',
      actorType: 'agent',
      data: {
        task_id: 'task-1',
        handoff_note: 'Authenticate with Bearer sk-live-secret-value to continue.',
        safe_field: 'no secrets here',
      },
    });

    const payload = query.mock.calls[0]?.[1]?.[6] as Record<string, unknown>;
    expect(payload.handoff_note).toBe('redacted://event-secret');
    expect(payload.safe_field).toBe('no secrets here');
    expect(payload.task_id).toBe('task-1');
  });

  it('redacts secret-bearing event payload fields before persistence', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const service = new EventService({ query } as never);

    await service.emit({
      tenantId: 'tenant-1',
      type: 'workflow.activation_queued',
      entityType: 'workflow',
      entityId: 'workflow-1',
      actorType: 'system',
      data: {
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        api_key: 'sk-secret-value',
        headers: {
          Authorization: 'Bearer top-secret-token',
        },
        nested: {
          refresh_token: 'secret:oauth-refresh',
        },
      },
    });

    const payload = query.mock.calls[0]?.[1]?.[6] as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({
        workflow_id: 'workflow-1',
        activation_id: 'activation-1',
        api_key: 'redacted://event-secret',
        headers: {
          Authorization: 'redacted://event-secret',
        },
        nested: {
          refresh_token: 'redacted://event-secret',
        },
      }),
    );
  });
});
