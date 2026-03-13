import { describe, expect, it } from 'vitest';

import {
  buildWebhookInspectPackets,
  buildWebhookOperatorFocus,
  createWebhookFormState,
  describeWebhookCoverage,
  summarizeWebhookSelection,
  summarizeWebhookCollection,
  validateWebhookForm,
  WEBHOOK_EVENT_GROUPS,
} from './webhooks-page.support.js';

describe('webhooks page support', () => {
  it('validates destination url and optional secret length', () => {
    expect(
      validateWebhookForm({
        url: '',
        event_types: [],
        secret: 'short',
      }),
    ).toEqual({
      fieldErrors: {
        url: 'Enter a destination URL.',
        secret: 'Secrets must be at least 8 characters or left blank.',
      },
      issues: ['Enter a destination URL.', 'Secrets must be at least 8 characters or left blank.'],
      isValid: false,
    });
  });

  it('accepts valid webhook settings and summarizes event coverage', () => {
    expect(
      validateWebhookForm({
        url: 'https://example.com/webhook',
        event_types: ['workflow.failed'],
        secret: 'signing-secret',
      }).isValid,
    ).toBe(true);
    expect(describeWebhookCoverage([])).toBe('All supported events');
    expect(describeWebhookCoverage(['workflow.failed', 'task.failed'])).toBe('2 event filters');
    expect(WEBHOOK_EVENT_GROUPS.map((group) => group.key)).toEqual([
      'workflow',
      'work_item',
      'task',
    ]);
  });

  it('builds operator summary packets for configured webhooks', () => {
    expect(
      summarizeWebhookCollection([
        { is_active: true, event_types: [] },
        { is_active: false, event_types: ['workflow.failed'] },
      ]),
    ).toEqual([
      {
        label: 'Configured endpoints',
        value: '2',
        detail: '2 outbound destinations configured',
      },
      {
        label: 'Delivery posture',
        value: '1 active',
        detail: '1 paused endpoint',
      },
      {
        label: 'Coverage',
        value: '1 filtered',
        detail: '1 endpoint receives all supported events',
      },
    ]);
  });

  it('summarizes webhook selection posture for the create dialog', () => {
    expect(summarizeWebhookSelection([])).toEqual([
      {
        label: 'Coverage mode',
        value: 'All events',
        detail: 'Leaving every event clear sends all supported webhook events.',
      },
      {
        label: 'Selected families',
        value: '0',
        detail: 'All event families are currently included.',
      },
      {
        label: 'Selected events',
        value: 'All supported',
        detail: 'All supported events',
      },
    ]);
  });

  it('builds operator guidance and inspect packets for lifecycle review', () => {
    expect(
      createWebhookFormState({ url: 'https://example.com/hook', event_types: ['workflow.failed'] }),
    ).toEqual({
      url: 'https://example.com/hook',
      event_types: ['workflow.failed'],
      secret: '',
    });

    expect(
      buildWebhookOperatorFocus([
        { is_active: true, event_types: [] },
        { is_active: false, event_types: ['workflow.failed'] },
      ]),
    ).toEqual({
      heading: 'Delivery posture needs review',
      summary:
        'One endpoint is paused, which can silently block notifications the operator expects to receive.',
      nextAction:
        'Inspect paused endpoints first. Reactivate anything still in service, then delete stale destinations so the catalog reflects reality.',
      packets: [
        {
          label: 'Configured endpoints',
          value: '2',
          detail: '2 outbound destinations configured',
        },
        {
          label: 'Delivery posture',
          value: '1 active',
          detail: '1 paused endpoint',
        },
        {
          label: 'Coverage',
          value: '1 filtered',
          detail: '1 endpoint receives all supported events',
        },
      ],
    });

    expect(
      buildWebhookInspectPackets({
        is_active: false,
        event_types: ['workflow.failed'],
        created_at: '2026-03-12T12:00:00.000Z',
      }),
    ).toEqual([
      {
        label: 'Delivery state',
        value: 'Paused delivery',
        detail:
          'The endpoint is stored but will not receive outbound events until it is re-enabled.',
      },
      {
        label: 'Coverage',
        value: '1 event filter',
        detail: '1 event family is explicitly selected.',
      },
      {
        label: 'Created',
        value: 'Timestamp recorded',
        detail:
          'Use the created timestamp to confirm whether this endpoint predates the current workflow rollout.',
      },
    ]);
  });
});
