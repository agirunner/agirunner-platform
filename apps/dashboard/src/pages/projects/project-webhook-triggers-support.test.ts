import { describe, expect, it } from 'vitest';

import { buildWebhookTriggerOverview } from './project-webhook-triggers-support.js';

describe('project webhook triggers support', () => {
  it('returns empty-state overview when no triggers exist', () => {
    const overview = buildWebhookTriggerOverview([]);
    expect(overview.heading).toBe('No webhook triggers are configured yet');
    expect(overview.summary).toContain('first inbound hook');
    expect(overview.packets).toHaveLength(3);
    expect(overview.packets[0]).toMatchObject({
      label: 'Webhook coverage',
      value: '0 triggers',
    });
    expect(overview.packets[1]).toMatchObject({
      label: 'Attention needed',
      value: '0 items',
    });
    expect(overview.packets[2]).toMatchObject({
      label: 'Source wiring',
      value: 'Not configured',
    });
  });

  it('returns healthy overview when all triggers are active with secrets', () => {
    const overview = buildWebhookTriggerOverview([
      {
        id: 'wh-1',
        name: 'GitHub push',
        source: 'github.webhook',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-hub-signature-256',
        signature_mode: 'hmac_sha256',
        is_active: true,
        secret_configured: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(overview.heading).toBe('Webhook posture is healthy');
    expect(overview.summary).toContain('1 active webhook trigger');
    expect(overview.packets[0]).toMatchObject({
      label: 'Webhook coverage',
      value: '1 trigger',
      detail: '1 active • 0 paused',
    });
    expect(overview.packets[1]).toMatchObject({
      label: 'Attention needed',
      value: 'Healthy',
    });
    expect(overview.packets[2]).toMatchObject({
      label: 'Source wiring',
      value: '1 live',
    });
  });

  it('flags paused triggers needing review', () => {
    const overview = buildWebhookTriggerOverview([
      {
        id: 'wh-1',
        name: 'Active trigger',
        source: 'github.webhook',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-hub-signature-256',
        signature_mode: 'hmac_sha256',
        is_active: true,
        secret_configured: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'wh-2',
        name: 'Paused trigger',
        source: 'gitea.webhook',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-gitea-signature',
        signature_mode: 'hmac_sha256',
        is_active: false,
        secret_configured: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(overview.heading).toBe('Webhook attention is needed');
    expect(overview.summary).toContain('1 webhook trigger');
    expect(overview.summary).toContain('paused');
    expect(overview.packets[0]).toMatchObject({
      label: 'Webhook coverage',
      value: '2 triggers',
      detail: '1 active • 1 paused',
    });
    expect(overview.packets[1]).toMatchObject({
      label: 'Attention needed',
      value: '1 need review',
    });
  });

  it('flags active triggers missing secret configuration', () => {
    const overview = buildWebhookTriggerOverview([
      {
        id: 'wh-1',
        name: 'No secret',
        source: 'github.webhook',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-hub-signature-256',
        signature_mode: 'hmac_sha256',
        is_active: true,
        secret_configured: false,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(overview.heading).toBe('Webhook attention is needed');
    expect(overview.summary).toContain('lack signature verification');
    expect(overview.packets[1]).toMatchObject({
      label: 'Attention needed',
      value: '1 need review',
    });
  });

  it('shows all-paused summary when every trigger is disabled', () => {
    const overview = buildWebhookTriggerOverview([
      {
        id: 'wh-1',
        name: 'Disabled',
        source: 'github.webhook',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-hub-signature-256',
        signature_mode: 'hmac_sha256',
        is_active: false,
        secret_configured: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(overview.packets[2]).toMatchObject({
      label: 'Source wiring',
      value: 'All paused',
    });
  });

  it('uses correct grammar for multiple triggers', () => {
    const overview = buildWebhookTriggerOverview([
      {
        id: 'wh-1',
        name: 'A',
        source: 'a',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-sig',
        signature_mode: 'hmac_sha256',
        is_active: true,
        secret_configured: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'wh-2',
        name: 'B',
        source: 'b',
        project_id: 'proj-1',
        workflow_id: 'wf-1',
        signature_header: 'x-sig',
        signature_mode: 'hmac_sha256',
        is_active: true,
        secret_configured: true,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    ]);
    expect(overview.summary).toContain('2 active webhook triggers are receiving');
    expect(overview.packets[0].value).toBe('2 triggers');
    expect(overview.packets[2].value).toBe('2 live');
  });
});
