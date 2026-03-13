import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../src/errors/domain-errors.js';
import { WebhookWorkItemTriggerService } from '../../src/services/webhook-work-item-trigger-service.js';
import { encryptWebhookSecret } from '../../src/services/webhook-secret-crypto.js';

describe('WebhookWorkItemTriggerService', () => {
  const encryptionKey = '12345678901234567890123456789012';
  const rawBody = Buffer.from(JSON.stringify({
    issue: { title: 'Fix prod bug' },
    details: 'Investigate now',
    dedupe: 'evt-1',
    routing: { stage: 'triage', column: 'backlog' },
  }));
  let pool: { query: ReturnType<typeof vi.fn> };
  let eventService: { emit: ReturnType<typeof vi.fn> };
  let workflowService: { createWorkflowWorkItem: ReturnType<typeof vi.fn> };
  let service: WebhookWorkItemTriggerService;

  beforeEach(async () => {
    pool = { query: vi.fn() };
    eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    workflowService = { createWorkflowWorkItem: vi.fn() };
    service = new WebhookWorkItemTriggerService(pool as never, eventService as never, workflowService as never, encryptionKey);
  });

  it('creates a workflow work item from a webhook trigger with dedupe-backed request ids', async () => {
    const trigger = await buildTriggerRow();
    const signature = sign(rawBody, 'webhook-secret');
    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    workflowService.createWorkflowWorkItem.mockResolvedValue({ id: 'wi-1' });

    const result = await service.invokeTrigger(
      trigger.id,
      { 'x-signature': signature, 'x-event-type': 'github.pr_opened' },
      rawBody,
      JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
    );

    expect(result).toEqual({
      accepted: true,
      created: true,
      work_item_id: 'wi-1',
      event_type: 'github.pr_opened',
    });
    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'webhook_trigger',
        keyPrefix: `trigger:${trigger.id}`,
      }),
      trigger.workflow_id,
      expect.objectContaining({
        request_id: `trigger:${trigger.id}:evt-1`,
        title: 'Fix prod bug',
        goal: 'Investigate now',
        stage_name: 'triage',
        column_id: 'backlog',
        owner_role: 'triager',
        priority: 'high',
        metadata: expect.objectContaining({
          source_kind: 'webhook',
          trigger: expect.objectContaining({
            trigger_id: trigger.id,
            source: trigger.source,
            event_type: 'github.pr_opened',
          }),
        }),
      }),
    );
    expect(eventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'trigger.fired',
        entityType: 'workflow',
        entityId: trigger.workflow_id,
        actorType: 'system',
      }),
    );
  });

  it('returns duplicate responses without creating a second work item', async () => {
    const trigger = await buildTriggerRow();
    const signature = sign(rawBody, 'webhook-secret');
    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', work_item_id: 'wi-existing', status: 'created' }], rowCount: 1 });

    const result = await service.invokeTrigger(
      trigger.id,
      { 'x-signature': signature, 'x-event-type': 'github.pr_opened' },
      rawBody,
      JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
    );

    expect(result).toEqual({
      accepted: true,
      created: false,
      duplicate: true,
      work_item_id: 'wi-existing',
      event_type: 'github.pr_opened',
    });
    expect(workflowService.createWorkflowWorkItem).not.toHaveBeenCalled();
    expect(eventService.emit).not.toHaveBeenCalled();
  });

  it('records failed mapped stage validation without treating it as a permanent duplicate', async () => {
    const trigger = await buildTriggerRow();
    const invalidPayload = {
      issue: { title: 'Fix prod bug' },
      details: 'Investigate now',
      dedupe: 'evt-1',
      routing: { stage: 'qa', column: 'backlog' },
    };
    const fixedPayload = {
      issue: { title: 'Fix prod bug' },
      details: 'Investigate now',
      dedupe: 'evt-1',
      routing: { stage: 'triage', column: 'backlog' },
    };
    const invalidBody = Buffer.from(JSON.stringify(invalidPayload));
    const fixedBody = Buffer.from(JSON.stringify(fixedPayload));
    const invalidSignature = sign(invalidBody, 'webhook-secret');
    const fixedSignature = sign(fixedBody, 'webhook-secret');

    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: 'inv-1', work_item_id: null, status: 'failed' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    workflowService.createWorkflowWorkItem
      .mockRejectedValueOnce(new ValidationError("Unknown stage 'qa' for this playbook"))
      .mockResolvedValueOnce({ id: 'wi-1' });

    await expect(
      service.invokeTrigger(
        trigger.id,
        { 'x-signature': invalidSignature, 'x-event-type': 'github.pr_opened' },
        invalidBody,
        invalidPayload,
      ),
    ).rejects.toThrowError(new ValidationError("Unknown stage 'qa' for this playbook"));

    const success = await service.invokeTrigger(
      trigger.id,
      { 'x-signature': fixedSignature, 'x-event-type': 'github.pr_opened' },
      fixedBody,
      fixedPayload,
    );

    expect(success).toEqual({
      accepted: true,
      created: true,
      work_item_id: 'wi-1',
      event_type: 'github.pr_opened',
    });
    expect(eventService.emit).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1,$2,$3,$4,NULL,'failed',$5)"),
      ['tenant-1', 'trigger-1', 'github.pr_opened', 'evt-1', "Unknown stage 'qa' for this playbook"],
    );
  });

  it('records failed mapped column validation without creating a work item', async () => {
    const trigger = await buildTriggerRow();
    const invalidPayload = {
      issue: { title: 'Fix prod bug' },
      details: 'Investigate now',
      dedupe: 'evt-2',
      routing: { stage: 'triage', column: 'qa' },
    };
    const invalidBody = Buffer.from(JSON.stringify(invalidPayload));
    const invalidSignature = sign(invalidBody, 'webhook-secret');

    pool.query
      .mockResolvedValueOnce({ rows: [trigger], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    workflowService.createWorkflowWorkItem.mockRejectedValueOnce(
      new ValidationError("Unknown board column 'qa' for this playbook"),
    );

    await expect(
      service.invokeTrigger(
        trigger.id,
        { 'x-signature': invalidSignature, 'x-event-type': 'github.pr_opened' },
        invalidBody,
        invalidPayload,
      ),
    ).rejects.toThrowError(new ValidationError("Unknown board column 'qa' for this playbook"));

    expect(workflowService.createWorkflowWorkItem).toHaveBeenCalledWith(
      expect.anything(),
      'workflow-1',
      expect.objectContaining({
        request_id: 'trigger:trigger-1:evt-2',
        stage_name: 'triage',
        column_id: 'qa',
      }),
    );
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1,$2,$3,$4,NULL,'failed',$5)"),
      ['tenant-1', 'trigger-1', 'github.pr_opened', 'evt-2', "Unknown board column 'qa' for this playbook"],
    );
  });

  it('rejects webhook triggers that target a non-playbook workflow', async () => {
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
        name: 'GitHub PR Opened',
        source: 'github',
        workflow_id: 'workflow-1',
        signature_header: 'X-Signature',
        signature_mode: 'hmac_sha256',
        secret: 'webhook-secret',
        defaults: { title: 'Fallback title' },
      },
    )).rejects.toThrowError(new ValidationError('Webhook work item triggers must target a playbook workflow'));
  });

  it('rejects webhook triggers with an invalid default stage', async () => {
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
        name: 'GitHub PR Opened',
        source: 'github',
        workflow_id: 'workflow-1',
        signature_header: 'X-Signature',
        signature_mode: 'hmac_sha256',
        secret: 'webhook-secret',
        defaults: {
          title: 'Fallback title',
          stage_name: 'qa',
        },
      },
    )).rejects.toThrowError(new ValidationError("Webhook trigger default stage_name must match a playbook stage"));
  });

  it('rejects webhook triggers with an invalid default column', async () => {
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
        name: 'GitHub PR Opened',
        source: 'github',
        workflow_id: 'workflow-1',
        signature_header: 'X-Signature',
        signature_mode: 'hmac_sha256',
        secret: 'webhook-secret',
        defaults: {
          title: 'Fallback title',
          column_id: 'qa',
        },
      },
    )).rejects.toThrowError(new ValidationError("Webhook trigger default column_id must match a playbook board column"));
  });

  it('migrates plaintext stored trigger secrets during public list reads', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [
          {
            ...(await buildTriggerRow()),
            secret: 'legacy-trigger-secret',
            field_mappings: {
              title: 'issue.title',
              metadata: {
                authorization: 'Bearer trigger-metadata-secret',
              },
            },
            defaults: {
              owner_role: 'triager',
              metadata: {
                webhook_secret: 'plain-trigger-secret',
                secret_ref: 'secret:TRIGGER_SECRET',
              },
            },
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await service.listTriggers('tenant-1');

    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 'trigger-1',
          field_mappings: {
            title: 'issue.title',
            metadata: {
              authorization: 'redacted://trigger-secret',
            },
          },
          defaults: {
            owner_role: 'triager',
            metadata: {
              webhook_secret: 'redacted://trigger-secret',
              secret_ref: 'redacted://trigger-secret',
            },
          },
          secret_configured: true,
        }),
      ],
    });
    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE webhook_work_item_triggers'),
      ['tenant-1', 'trigger-1', expect.stringMatching(/^enc:v\d+:/)],
    );
  });

  async function buildTriggerRow() {
    return {
      id: 'trigger-1',
      tenant_id: 'tenant-1',
      name: 'GitHub PR Opened',
      source: 'github',
      project_id: 'project-1',
      workflow_id: 'workflow-1',
      event_header: 'X-Event-Type',
      event_types: ['github.pr_opened'],
      signature_header: 'X-Signature',
      signature_mode: 'hmac_sha256' as const,
      secret: encryptWebhookSecret('webhook-secret', encryptionKey),
      field_mappings: {
        title: 'issue.title',
        goal: 'details',
        dedupe_key: 'dedupe',
        stage_name: 'routing.stage',
        column_id: 'routing.column',
      },
      defaults: {
        owner_role: 'triager',
        priority: 'high',
        metadata: {
          source_kind: 'webhook',
        },
      },
      is_active: true,
      created_at: new Date('2026-03-11T00:00:00Z'),
      updated_at: new Date('2026-03-11T00:00:00Z'),
    };
  }

  function sign(body: Buffer, secret: string) {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
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
});
