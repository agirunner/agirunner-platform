import { describe, expect, it } from 'vitest';

import {
  buildTriggerOperatorFocus,
  describeScheduledTriggerHealth,
  describeScheduledTriggerNextAction,
  describeWebhookTriggerActivity,
  describeWebhookTriggerNextAction,
  describeScheduledTriggerPacket,
  describeWebhookTriggerPacket,
  summarizeTriggerOverview,
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
});
