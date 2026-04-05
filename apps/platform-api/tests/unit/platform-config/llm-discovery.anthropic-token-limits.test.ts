import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmDiscoveryService } from '../../../src/services/platform-config/llm-discovery-service.js';

function mockFetchResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

describe('LlmDiscoveryService Anthropic token limits', () => {
  let service: LlmDiscoveryService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    service = new LlmDiscoveryService();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses Anthropic API token limits when the models endpoint provides them', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        data: [
          {
            id: 'claude-sonnet-4-6',
            display_name: 'Claude Sonnet 4.6',
            created_at: '2026-02-17T00:00:00Z',
            max_input_tokens: 1_000_000,
            max_tokens: 128_000,
          },
        ],
      }),
    );

    const result = await service.validateAndDiscover('anthropic', 'https://api.anthropic.com', 'ant-key');

    expect(result).toHaveLength(1);
    expect(result[0].modelId).toBe('claude-sonnet-4-6');
    expect(result[0].contextWindow).toBe(1_000_000);
    expect(result[0].maxOutputTokens).toBe(128_000);
    expect(result[0].endpointType).toBe('messages');
  });
});
