import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebhookAuditExporter } from '../../src/services/audit-service.js';

describe('WebhookAuditExporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts audit envelopes to the configured webhook endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const exporter = new WebhookAuditExporter('https://siem.example.test/audit', 1000, 'secret-token');
    await exporter.export({
      id: 1,
      tenant_id: 'tenant-1',
      action: 'task.created',
      resource_type: 'task',
      resource_id: 'task-1',
      actor_type: 'user',
      actor_id: 'user-1',
      outcome: 'success',
      reason: null,
      request_id: 'req-1',
      source_ip: '127.0.0.1',
      metadata: { example: true },
      created_at: new Date('2026-03-07T00:00:00Z'),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://siem.example.test/audit',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer secret-token',
          'content-type': 'application/json',
        }),
      }),
    );
  });
});
