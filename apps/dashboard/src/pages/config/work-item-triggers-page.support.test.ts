import { describe, expect, it } from 'vitest';

import {
  buildTriggerOperatorFocus,
  buildWebhookTriggerCreatePayload,
  buildWebhookTriggerUpdatePayload,
  createWebhookTriggerFormState,
  describeScheduledTriggerHealth,
  describeScheduledTriggerNextAction,
  describeWebhookTriggerActivity,
  describeWebhookTriggerNextAction,
  describeScheduledTriggerPacket,
  describeWebhookTriggerPacket,
  hydrateWebhookTriggerForm,
  summarizeTriggerOverview,
  validateWebhookTriggerForm,
} from './work-item-triggers-page.support.js';

describe('work item triggers page support', () => {
  it('summarizes scheduled and webhook trigger posture for operators', () => {
    expect(
      summarizeTriggerOverview(
        [
          {
            id: 'scheduled-1',
            project_id: 'project-1',
            workflow_id: 'workflow-1',
            name: 'Daily triage',
            source: 'project.schedule',
            cadence_minutes: 60,
            next_fire_at: '2999-01-01T00:00:00.000Z',
            is_active: true,
            defaults: {},
            last_fired_at: null,
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
          },
        ],
        [
          {
            id: 'webhook-1',
            project_id: 'project-1',
            workflow_id: 'workflow-1',
            name: 'GitHub push',
            source: 'github.webhook',
            signature_mode: 'hmac_sha256',
            signature_header: 'x-hub-signature-256',
            is_active: true,
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
          },
        ],
      ),
    ).toEqual([
      {
        label: 'Automation coverage',
        value: '1 rules',
        detail: '1 active recurring rule across project automation',
      },
      {
        label: 'Recovery pressure',
        value: 'Healthy',
        detail: 'No scheduled or inbound automation needs recovery',
      },
      {
        label: 'Webhook intake',
        value: '1/1 live',
        detail: '1 active inbound webhook trigger',
      },
    ]);
  });

  it('describes scheduled and webhook packets in human-readable terms', () => {
    expect(
      describeScheduledTriggerPacket({
        id: 'scheduled-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Daily triage',
        source: 'project.schedule',
        cadence_minutes: 90,
        next_fire_at: '2999-03-12T18:30:00.000Z',
        is_active: true,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      cadence: 'Every 1 hr 30 min',
      source: 'project.schedule',
      nextAction: 'Monitor the next run and adjust cadence or defaults from project automation if the work changed.',
    });
    expect(
      describeWebhookTriggerPacket({
        id: 'webhook-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'GitHub push',
        source: 'github.webhook',
        signature_mode: 'hmac_sha256',
        signature_header: 'x-hub-signature-256',
        is_active: false,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toEqual({
      source: 'github.webhook',
      mode: 'hmac_sha256',
      activity: 'Disabled',
      nextAction: 'Re-enable only after validating signature mode, headers, and source-system wiring.',
    });
  });

  it('flags due scheduled rules', () => {
    expect(
      describeScheduledTriggerHealth({
        id: 'scheduled-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Daily triage',
        source: 'project.schedule',
        cadence_minutes: 60,
        next_fire_at: '2000-01-01T00:00:00.000Z',
        is_active: true,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toEqual({ label: 'Due', variant: 'warning' });
  });

  it('builds operator focus and next-step guidance for paused or overdue automation', () => {
    expect(
      buildTriggerOperatorFocus(
        [
          {
            id: 'scheduled-1',
            project_id: 'project-1',
            workflow_id: 'workflow-1',
            name: 'Daily triage',
            source: 'project.schedule',
            cadence_minutes: 60,
            next_fire_at: '2000-01-01T00:00:00.000Z',
            is_active: true,
            defaults: {},
            last_fired_at: null,
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
          },
        ],
        [],
      ),
    ).toEqual({
      title: 'Recover overdue automation',
      value: '1 due now',
      detail: 'Open the owning project automation settings and confirm the recurring work-item rule can fire immediately.',
    });

    expect(
      describeScheduledTriggerNextAction({
        id: 'scheduled-2',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Disabled triage',
        source: 'project.schedule',
        cadence_minutes: 60,
        next_fire_at: '2999-01-01T00:00:00.000Z',
        is_active: false,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toBe(
      'Re-enable only after confirming cadence, board target, and default routing in project automation.',
    );

    expect(
      describeWebhookTriggerActivity({
        id: 'webhook-1',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'GitHub push',
        source: 'github.webhook',
        signature_mode: 'hmac_sha256',
        signature_header: 'x-hub-signature-256',
        is_active: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toEqual({ label: 'Active', variant: 'success' });

    expect(
      describeWebhookTriggerNextAction({
        id: 'webhook-2',
        project_id: 'project-1',
        workflow_id: 'workflow-1',
        name: 'Paused push',
        source: 'github.webhook',
        signature_mode: 'hmac_sha256',
        signature_header: 'x-hub-signature-256',
        is_active: false,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toBe(
      'Re-enable only after validating signature mode, headers, and source-system wiring.',
    );
  });

  it('creates a blank form state with sensible defaults', () => {
    const form = createWebhookTriggerFormState();
    expect(form.name).toBe('');
    expect(form.signatureHeader).toBe('x-hub-signature-256');
    expect(form.signatureMode).toBe('hmac_sha256');
    expect(form.secretConfigured).toBe(false);
    expect(form.isActive).toBe(true);
    expect(form.fieldMappings).toBe('{}');
    expect(form.defaults).toBe('{}');
  });

  it('hydrates form state from an existing trigger record', () => {
    const form = hydrateWebhookTriggerForm({
      id: 'wh-1',
      name: 'GitHub PR',
      source: 'github.webhook',
      project_id: 'proj-1',
      workflow_id: 'wf-1',
      event_header: 'x-github-event',
      event_types: ['pull_request', 'push'],
      signature_header: 'x-hub-signature-256',
      signature_mode: 'hmac_sha256',
      field_mappings: { title: '$.pull_request.title' },
      defaults: { priority: 'high' },
      is_active: false,
      secret_configured: true,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });
    expect(form.name).toBe('GitHub PR');
    expect(form.projectId).toBe('proj-1');
    expect(form.eventTypes).toBe('pull_request, push');
    expect(form.secret).toBe('');
    expect(form.secretConfigured).toBe(true);
    expect(form.isActive).toBe(false);
    expect(JSON.parse(form.fieldMappings)).toEqual({ title: '$.pull_request.title' });
    expect(JSON.parse(form.defaults)).toEqual({ priority: 'high' });
  });

  it('validates required fields on create mode', () => {
    const blank = createWebhookTriggerFormState();
    const result = validateWebhookTriggerForm(blank, 'create');
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors['name']).toBe('Add a trigger name.');
    expect(result.fieldErrors['source']).toBe('Add a source identifier.');
    expect(result.fieldErrors['workflowId']).toBe('Select a target workflow.');
    expect(result.fieldErrors['secret']).toBe('Add a shared secret for new triggers.');
  });

  it('allows blank secret on edit mode', () => {
    const form = {
      ...createWebhookTriggerFormState(),
      name: 'Test',
      source: 'test.webhook',
      workflowId: 'wf-1',
      signatureHeader: 'x-sig',
    };
    const result = validateWebhookTriggerForm(form, 'edit');
    expect(result.isValid).toBe(true);
    expect(result.fieldErrors['secret']).toBeUndefined();
  });

  it('rejects invalid JSON in field mappings and defaults', () => {
    const form = {
      ...createWebhookTriggerFormState(),
      name: 'Test',
      source: 'test.webhook',
      workflowId: 'wf-1',
      signatureHeader: 'x-sig',
      secret: 'secret123',
      fieldMappings: '{ broken',
      defaults: '[]',
    };
    const result = validateWebhookTriggerForm(form, 'create');
    expect(result.isValid).toBe(false);
    expect(result.fieldErrors['fieldMappings']).toBe('Field mappings must be valid JSON.');
    expect(result.fieldErrors['defaults']).toBe('Defaults must be a JSON object.');
  });

  it('requires an event header when event type filters are configured and rejects duplicate event types', () => {
    const form = {
      ...createWebhookTriggerFormState(),
      name: 'GitHub push',
      source: 'github.webhook',
      workflowId: 'wf-1',
      signatureHeader: 'x-sig',
      secret: 'secret123',
      eventTypes: 'push, PUSH',
    };

    const result = validateWebhookTriggerForm(form, 'create');

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors['eventHeader']).toBe(
      'Add an event header when filtering by event type.',
    );
    expect(result.fieldErrors['eventTypes']).toBe('Event types must be unique.');
  });

  it('requires a namespaced source and a header value without spaces', () => {
    const form = {
      ...createWebhookTriggerFormState(),
      name: 'GitHub push',
      source: 'github',
      workflowId: 'wf-1',
      signatureHeader: 'x hub sig',
      secret: 'secret123',
    };

    const result = validateWebhookTriggerForm(form, 'create');

    expect(result.isValid).toBe(false);
    expect(result.fieldErrors['source']).toBe(
      'Use a namespaced source such as github.webhook or jira.issue.created.',
    );
    expect(result.fieldErrors['signatureHeader']).toBe(
      'Signature headers cannot contain spaces.',
    );
  });

  it('builds a create payload from valid form state', () => {
    const form = {
      ...createWebhookTriggerFormState(),
      name: 'GitHub PR',
      source: 'github.webhook',
      projectId: 'proj-1',
      workflowId: 'wf-1',
      eventHeader: 'x-github-event',
      eventTypes: 'push, pull_request',
      signatureHeader: 'x-hub-signature-256',
      signatureMode: 'hmac_sha256' as const,
      secret: 'secret123',
      fieldMappings: '{"title": "$.title"}',
      defaults: '{"priority": "medium"}',
      isActive: true,
    };
    const payload = buildWebhookTriggerCreatePayload(form);
    expect(payload.name).toBe('GitHub PR');
    expect(payload.project_id).toBe('proj-1');
    expect(payload.event_types).toEqual(['push', 'pull_request']);
    expect(payload.field_mappings).toEqual({ title: '$.title' });
    expect(payload.defaults).toEqual({ priority: 'medium' });
    expect(payload.secret).toBe('secret123');
  });

  it('builds an update payload omitting secret when blank', () => {
    const form = {
      ...createWebhookTriggerFormState(),
      name: 'Updated',
      source: 'updated.webhook',
      workflowId: 'wf-2',
      signatureHeader: 'x-sig',
      secret: '',
    };
    const payload = buildWebhookTriggerUpdatePayload(form);
    expect(payload.name).toBe('Updated');
    expect(payload).not.toHaveProperty('secret');
    expect(payload.project_id).toBeNull();
  });
});
