import { describe, expect, it } from 'vitest';

import {
  createWebhookSignature,
  selectLeastLoadedWorker,
  verifyWebhookSignature,
} from '../../../../src/services/workers/worker-service.js';

describe('worker dispatch and webhook hmac', () => {
  it('picks least-loaded worker with matching routing tags', () => {
    const selected = selectLeastLoadedWorker(
      [
        { id: 'w3', status: 'online', routing_tags: ['role:typescript', 'testing'], currentLoad: 2 },
        { id: 'w1', status: 'busy', routing_tags: ['role:typescript', 'testing'], currentLoad: 1 },
        { id: 'w2', status: 'online', routing_tags: ['role:typescript'], currentLoad: 0 },
      ],
      ['role:typescript', 'testing'],
    );

    expect(selected?.id).toBe('w1');
  });

  it('creates and verifies webhook signature', () => {
    const secret = 'top-secret';
    const payload = JSON.stringify({ event: 'task.completed', id: 42 });
    const signature = createWebhookSignature(secret, payload);

    expect(signature).toHaveLength(64);
    expect(verifyWebhookSignature(secret, payload, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, payload, '00'.repeat(32))).toBe(false);
  });

  it('accepts only exact signatures using timing-safe comparison behavior', () => {
    const secret = 'timing-secret';
    const payload = JSON.stringify({ event: 'task.created', id: 7 });
    const signature = createWebhookSignature(secret, payload);

    const sameLengthButDifferent = signature.slice(0, -1) + (signature.endsWith('a') ? 'b' : 'a');

    expect(verifyWebhookSignature(secret, payload, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, payload, sameLengthButDifferent)).toBe(false);
    expect(verifyWebhookSignature(secret, payload, signature.slice(0, -2))).toBe(false);
  });

});
