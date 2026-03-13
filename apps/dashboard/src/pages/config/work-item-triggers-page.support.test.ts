import { describe, expect, it } from 'vitest';

import {
  describeScheduledTriggerHealth,
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
        label: 'Scheduled rules',
        value: '1',
        detail: '1 active automation rule',
      },
      {
        label: 'Needs attention',
        value: 'Healthy',
        detail: 'No scheduled rules are overdue',
      },
      {
        label: 'Webhook intake',
        value: '1',
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
        next_fire_at: '2026-03-12T18:30:00.000Z',
        is_active: true,
        defaults: {},
        last_fired_at: null,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      }),
    ).toMatchObject({
      cadence: 'Every 1 hr 30 min',
      source: 'project.schedule',
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
});
