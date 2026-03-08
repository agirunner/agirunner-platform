import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { LlmDiscoveryService, KNOWN_MODELS } from '../../src/services/llm-discovery-service.js';

function mockFetchResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

describe('LlmDiscoveryService', () => {
  let service: LlmDiscoveryService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    service = new LlmDiscoveryService();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('KNOWN_MODELS catalog', () => {
    it('contains gpt-4o with chat-completions endpoint and no reasoning', () => {
      const model = KNOWN_MODELS['gpt-4o'];
      expect(model).toBeDefined();
      expect(model.endpointType).toBe('chat-completions');
      expect(model.contextWindow).toBe(128000);
      expect(model.reasoningConfig).toBeNull();
    });

    it('contains gpt-5 with minimal/low/medium/high reasoning_effort', () => {
      const model = KNOWN_MODELS['gpt-5'];
      expect(model).toBeDefined();
      expect(model.endpointType).toBe('responses');
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('reasoning_effort');
      expect(model.reasoningConfig!.options).toEqual(['minimal', 'low', 'medium', 'high']);
      expect(model.reasoningConfig!.default).toBe('medium');
    });

    it('contains gpt-5.2 with xhigh reasoning and default none', () => {
      const model = KNOWN_MODELS['gpt-5.2'];
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.options).toContain('xhigh');
      expect(model.reasoningConfig!.options).toContain('none');
      expect(model.reasoningConfig!.default).toBe('none');
    });

    it('contains gpt-5.1 with default medium (not none)', () => {
      const model = KNOWN_MODELS['gpt-5.1'];
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.default).toBe('medium');
      expect(model.reasoningConfig!.options).toContain('none');
    });

    it('contains o3 with responses endpoint and reasoning_effort', () => {
      const model = KNOWN_MODELS['o3'];
      expect(model).toBeDefined();
      expect(model.endpointType).toBe('responses');
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('reasoning_effort');
      expect(model.reasoningConfig!.default).toBe('medium');
    });

    it('contains claude-sonnet-4-6 with messages endpoint and effort config', () => {
      const model = KNOWN_MODELS['claude-sonnet-4-6'];
      expect(model).toBeDefined();
      expect(model.endpointType).toBe('messages');
      expect(model.contextWindow).toBe(200000);
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('effort');
      expect(model.reasoningConfig!.options).toContain('high');
    });

    it('contains claude-opus-4-6 with effort config including max', () => {
      const model = KNOWN_MODELS['claude-opus-4-6'];
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('effort');
      expect(model.reasoningConfig!.options).toContain('max');
    });

    it('contains gemini-3.1-pro-preview with thinking_level (no minimal)', () => {
      const model = KNOWN_MODELS['gemini-3.1-pro-preview'];
      expect(model).toBeDefined();
      expect(model.endpointType).toBe('generate-content');
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('thinking_level');
      expect(model.reasoningConfig!.options).toEqual(['low', 'medium', 'high']);
    });

    it('contains gemini-2.5-pro with thinking_budget min 128 max 32768', () => {
      const model = KNOWN_MODELS['gemini-2.5-pro'];
      expect(model).toBeDefined();
      expect(model.endpointType).toBe('generate-content');
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('thinking_budget');
      expect(model.reasoningConfig!.min).toBe(128);
      expect(model.reasoningConfig!.max).toBe(32768);
    });

    it('contains gemini-2.5-flash with thinking_budget min 0 max 24576', () => {
      const model = KNOWN_MODELS['gemini-2.5-flash'];
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('thinking_budget');
      expect(model.reasoningConfig!.min).toBe(0);
      expect(model.reasoningConfig!.max).toBe(24576);
    });

    it('marks claude-haiku-4-5 with no effort support', () => {
      const model = KNOWN_MODELS['claude-haiku-4-5'];
      expect(model).toBeDefined();
      expect(model.reasoningConfig).toBeNull();
    });

    it('contains claude-opus-4-5 with effort config', () => {
      const model = KNOWN_MODELS['claude-opus-4-5'];
      expect(model).toBeDefined();
      expect(model.reasoningConfig).not.toBeNull();
      expect(model.reasoningConfig!.type).toBe('effort');
      expect(model.reasoningConfig!.default).toBe('high');
    });
  });

  describe('error handling', () => {
    it('returns empty array for unknown provider type', async () => {
      const result = await service.validateAndDiscover('unknown', 'https://api.example.com', 'key');
      expect(result).toEqual([]);
    });

    it('returns empty array when API returns error status', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(mockFetchResponse({}, 500));
      const result = await service.validateAndDiscover('openai', 'https://api.openai.com/v1', 'key');
      expect(result).toEqual([]);
    });

    it('returns empty array when fetch throws', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network error'));
      const result = await service.validateAndDiscover('openai', 'https://api.openai.com/v1', 'key');
      expect(result).toEqual([]);
    });
  });

  describe('OpenAI discovery', () => {
    it('parses models and filters to chat models only', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [
            { id: 'gpt-4o', created: 1700000000 },
            { id: 'gpt-4o-mini', created: 1700000000 },
            { id: 'whisper-1', created: 1700000000 },
            { id: 'text-embedding-ada-002', created: 1700000000 },
            { id: 'o3-mini', created: 1700000000 },
            { id: 'dall-e-3', created: 1700000000 },
            { id: 'chatgpt-4o-latest', created: 1700000000 },
          ],
        }),
      );

      const result = await service.validateAndDiscover('openai', 'https://api.openai.com/v1', 'sk-test');

      const ids = result.map((m) => m.modelId);
      expect(ids).toContain('gpt-4o');
      expect(ids).toContain('gpt-4o-mini');
      expect(ids).toContain('o3-mini');
      expect(ids).toContain('chatgpt-4o-latest');
      expect(ids).not.toContain('whisper-1');
      expect(ids).not.toContain('text-embedding-ada-002');
      expect(ids).not.toContain('dall-e-3');
    });

    it('enriches known models with catalog data including reasoning config', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [{ id: 'gpt-4o', created: 1700000000 }],
        }),
      );

      const result = await service.validateAndDiscover('openai', 'https://api.openai.com/v1', 'sk-test');

      expect(result[0].contextWindow).toBe(128000);
      expect(result[0].endpointType).toBe('chat-completions');
      expect(result[0].reasoningConfig).toBeNull();
    });

    it('sends correct authorization header', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({ data: [] }),
      );

      await service.validateAndDiscover('openai', 'https://api.openai.com/v1', 'sk-test');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          headers: { Authorization: 'Bearer sk-test' },
        }),
      );
    });
  });

  describe('Anthropic discovery', () => {
    it('parses models and filters to claude models', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2024-01-01' },
            { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', created_at: '2024-01-01' },
            { id: 'some-other-model', display_name: 'Other', created_at: '2024-01-01' },
          ],
        }),
      );

      const result = await service.validateAndDiscover('anthropic', 'https://api.anthropic.com', 'ant-key');

      const ids = result.map((m) => m.modelId);
      expect(ids).toContain('claude-sonnet-4-6');
      expect(ids).toContain('claude-opus-4-6');
      expect(ids).not.toContain('some-other-model');
    });

    it('sends correct headers for Anthropic', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({ data: [] }),
      );

      await service.validateAndDiscover('anthropic', 'https://api.anthropic.com', 'ant-key');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/models',
        expect.objectContaining({
          headers: {
            'x-api-key': 'ant-key',
            'anthropic-version': '2023-06-01',
          },
        }),
      );
    });

    it('uses display_name from response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [
            { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', created_at: '2024-01-01' },
          ],
        }),
      );

      const result = await service.validateAndDiscover('anthropic', 'https://api.anthropic.com', 'ant-key');
      expect(result[0].displayName).toBe('Claude Sonnet 4.6');
    });
  });

  describe('Google discovery', () => {
    it('parses models and filters by generateContent support', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          models: [
            {
              name: 'models/gemini-2.5-pro',
              displayName: 'Gemini 2.5 Pro',
              inputTokenLimit: 1048576,
              outputTokenLimit: 8192,
              supportedGenerationMethods: ['generateContent', 'countTokens'],
            },
            {
              name: 'models/embedding-001',
              displayName: 'Embedding 001',
              inputTokenLimit: 2048,
              outputTokenLimit: 1,
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
      );

      const result = await service.validateAndDiscover('google', 'https://generativelanguage.googleapis.com', 'goog-key');

      expect(result).toHaveLength(1);
      expect(result[0].modelId).toBe('gemini-2.5-pro');
    });

    it('uses inputTokenLimit from API for context_window', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          models: [
            {
              name: 'models/gemini-2.0-flash',
              displayName: 'Gemini 2.0 Flash',
              inputTokenLimit: 999999,
              outputTokenLimit: 4096,
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      );

      const result = await service.validateAndDiscover('google', 'https://generativelanguage.googleapis.com', 'goog-key');

      expect(result[0].contextWindow).toBe(999999);
      expect(result[0].maxOutputTokens).toBe(4096);
    });

    it('strips models/ prefix from model name', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              inputTokenLimit: 1048576,
              outputTokenLimit: 8192,
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      );

      const result = await service.validateAndDiscover('google', 'https://generativelanguage.googleapis.com', 'goog-key');
      expect(result[0].modelId).toBe('gemini-2.5-flash');
    });

    it('uses generate-content as default endpoint type', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          models: [
            {
              name: 'models/gemini-custom',
              displayName: 'Custom Gemini',
              inputTokenLimit: 32000,
              outputTokenLimit: 2048,
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      );

      const result = await service.validateAndDiscover('google', 'https://generativelanguage.googleapis.com', 'goog-key');
      expect(result[0].endpointType).toBe('generate-content');
    });
  });

  describe('OpenAI-compatible discovery', () => {
    it('accepts all models without prefix filtering', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [
            { id: 'llama3:70b', created: 1700000000 },
            { id: 'mistral:7b', created: 1700000000 },
            { id: 'qwen2:72b', created: 1700000000 },
          ],
        }),
      );

      const result = await service.validateAndDiscover('openai-compatible', 'http://localhost:11434/v1', 'key');

      const ids = result.map((m) => m.modelId);
      expect(ids).toContain('llama3:70b');
      expect(ids).toContain('mistral:7b');
      expect(ids).toContain('qwen2:72b');
    });

    it('defaults unknown models to chat-completions endpoint', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [{ id: 'custom-model' }],
        }),
      );

      const result = await service.validateAndDiscover('openai-compatible', 'http://localhost:8000/v1', '');

      expect(result[0].endpointType).toBe('chat-completions');
      expect(result[0].reasoningConfig).toBeNull();
      expect(result[0].contextWindow).toBeNull();
    });

    it('enriches known models even through compatible endpoint', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        mockFetchResponse({
          data: [{ id: 'gpt-4o' }],
        }),
      );

      const result = await service.validateAndDiscover('openai-compatible', 'http://proxy:8080/v1', 'key');

      expect(result[0].contextWindow).toBe(128000);
      expect(result[0].endpointType).toBe('chat-completions');
    });
  });
});
