import { describe, expect, it } from 'vitest';

import {
  describeWebhookCoverage,
  summarizeWebhookCollection,
  validateWebhookForm,
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
      issues: [
        'Enter a destination URL.',
        'Secrets must be at least 8 characters or left blank.',
      ],
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
});
