import { z } from 'zod';

/**
 * Reasoning configuration schema describing what a model supports.
 *
 * `type` matches the provider's actual API parameter name:
 *   - reasoning_effort (OpenAI): discrete options
 *   - effort (Anthropic): discrete options
 *   - thinking_level (Google Gemini 3+): discrete options
 *   - thinking_budget (Google Gemini 2.5): numeric range (legacy)
 *
 * For discrete types, `options` lists valid values.
 * For numeric types, `min`/`max` define the range.
 * `default` is the provider's documented default value.
 */
export interface ReasoningConfig {
  type: 'reasoning_effort' | 'effort' | 'thinking_level' | 'thinking_budget';
  options?: string[];
  min?: number;
  max?: number;
  default: string | number;
}

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  endpointType: string;
  reasoningConfig: ReasoningConfig | null;
}

interface KnownModelEntry {
  contextWindow: number;
  endpointType: string;
  reasoningConfig: ReasoningConfig | null;
}

/* ── OpenAI reasoning configs ──────────────────────────────────────────── */

const OPENAI_GPT5_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['minimal', 'low', 'medium', 'high'],
  default: 'medium',
};

const OPENAI_GPT5_PRO_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['high'],
  default: 'high',
};

const OPENAI_O_SERIES_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['low', 'medium', 'high'],
  default: 'medium',
};

const OPENAI_GPT51_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['none', 'low', 'medium', 'high'],
  default: 'medium',
};

const OPENAI_XHIGH_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['low', 'medium', 'high', 'xhigh'],
  default: 'medium',
};

const OPENAI_GPT52_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  default: 'none',
};

const OPENAI_GPT54_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['none', 'low', 'medium', 'high', 'xhigh'],
  default: 'none',
};

const OPENAI_GPT54_PRO_REASONING: ReasoningConfig = {
  type: 'reasoning_effort',
  options: ['medium', 'high', 'xhigh'],
  default: 'medium',
};

/* ── Anthropic reasoning configs ───────────────────────────────────────── */

const ANTHROPIC_OPUS_46_EFFORT: ReasoningConfig = {
  type: 'effort',
  options: ['low', 'medium', 'high', 'max'],
  default: 'high',
};

const ANTHROPIC_SONNET_46_EFFORT: ReasoningConfig = {
  type: 'effort',
  options: ['low', 'medium', 'high'],
  default: 'high',
};

const ANTHROPIC_OPUS_45_EFFORT: ReasoningConfig = {
  type: 'effort',
  options: ['low', 'medium', 'high'],
  default: 'high',
};

/* ── Google reasoning configs ──────────────────────────────────────────── */

const GEMINI_31_PRO_THINKING: ReasoningConfig = {
  type: 'thinking_level',
  options: ['low', 'medium', 'high'],
  default: 'high',
};

const GEMINI_3_PRO_THINKING: ReasoningConfig = {
  type: 'thinking_level',
  options: ['low', 'high'],
  default: 'high',
};

const GEMINI_3_FLASH_THINKING: ReasoningConfig = {
  type: 'thinking_level',
  options: ['minimal', 'low', 'medium', 'high'],
  default: 'high',
};

const GEMINI_31_FLASH_LITE_THINKING: ReasoningConfig = {
  type: 'thinking_level',
  options: ['minimal', 'low', 'medium', 'high'],
  default: 'high',
};

const GEMINI_25_PRO_THINKING: ReasoningConfig = {
  type: 'thinking_budget',
  min: 128,
  max: 32768,
  default: 0,
};

const GEMINI_25_FLASH_THINKING: ReasoningConfig = {
  type: 'thinking_budget',
  min: 0,
  max: 24576,
  default: 0,
};

export const KNOWN_MODELS: Record<string, KnownModelEntry> = {
  /* ── OpenAI: GPT-5.4 ─────────────────────────────────────────────────── */
  'gpt-5.4-pro': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT54_PRO_REASONING },
  'gpt-5.4': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT54_REASONING },

  /* ── OpenAI: GPT-5.3 ─────────────────────────────────────────────────── */
  'gpt-5.3-codex': { contextWindow: 400000, endpointType: 'responses', reasoningConfig: OPENAI_XHIGH_REASONING },

  /* ── OpenAI: GPT-5.2 ─────────────────────────────────────────────────── */
  'gpt-5.2': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT52_REASONING },
  'gpt-5.2-pro': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_XHIGH_REASONING },
  'gpt-5.2-codex': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_XHIGH_REASONING },

  /* ── OpenAI: GPT-5.1 ─────────────────────────────────────────────────── */
  'gpt-5.1-codex-max': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_XHIGH_REASONING },
  'gpt-5.1-codex': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_O_SERIES_REASONING },
  'gpt-5.1': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT51_REASONING },

  /* ── OpenAI: GPT-5 ───────────────────────────────────────────────────── */
  'gpt-5-pro': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT5_PRO_REASONING },
  'gpt-5-mini': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT5_REASONING },
  'gpt-5-nano': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT5_REASONING },
  'gpt-5-codex': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_O_SERIES_REASONING },
  'gpt-5': { contextWindow: 1050000, endpointType: 'responses', reasoningConfig: OPENAI_GPT5_REASONING },

  /* ── OpenAI: GPT-4.x legacy ─────────────────────────────────────────── */
  'gpt-4.1': { contextWindow: 1047576, endpointType: 'chat-completions', reasoningConfig: null },
  'gpt-4.1-mini': { contextWindow: 1047576, endpointType: 'chat-completions', reasoningConfig: null },
  'gpt-4.1-nano': { contextWindow: 1047576, endpointType: 'chat-completions', reasoningConfig: null },
  'gpt-4o': { contextWindow: 128000, endpointType: 'chat-completions', reasoningConfig: null },
  'gpt-4o-mini': { contextWindow: 128000, endpointType: 'chat-completions', reasoningConfig: null },

  /* ── OpenAI: o-series ────────────────────────────────────────────────── */
  'o3': { contextWindow: 200000, endpointType: 'responses', reasoningConfig: OPENAI_O_SERIES_REASONING },
  'o3-pro': { contextWindow: 200000, endpointType: 'responses', reasoningConfig: OPENAI_O_SERIES_REASONING },
  'o3-mini': { contextWindow: 200000, endpointType: 'responses', reasoningConfig: OPENAI_O_SERIES_REASONING },
  'o4-mini': { contextWindow: 200000, endpointType: 'responses', reasoningConfig: OPENAI_O_SERIES_REASONING },

  /* ── Anthropic: Claude 4.6 ───────────────────────────────────────────── */
  'claude-opus-4-6': { contextWindow: 200000, endpointType: 'messages', reasoningConfig: ANTHROPIC_OPUS_46_EFFORT },
  'claude-sonnet-4-6': { contextWindow: 200000, endpointType: 'messages', reasoningConfig: ANTHROPIC_SONNET_46_EFFORT },

  /* ── Anthropic: Claude 4.5 ───────────────────────────────────────────── */
  'claude-opus-4-5': { contextWindow: 200000, endpointType: 'messages', reasoningConfig: ANTHROPIC_OPUS_45_EFFORT },

  /* ── Anthropic: Claude 4 / Haiku ─────────────────────────────────────── */
  'claude-sonnet-4': { contextWindow: 200000, endpointType: 'messages', reasoningConfig: null },
  'claude-haiku-4-5': { contextWindow: 200000, endpointType: 'messages', reasoningConfig: null },

  /* ── Google: Gemini 3.x ──────────────────────────────────────────────── */
  'gemini-3.1-pro-preview': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: GEMINI_31_PRO_THINKING },
  'gemini-3-pro-preview': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: GEMINI_3_PRO_THINKING },
  'gemini-3-flash-preview': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: GEMINI_3_FLASH_THINKING },
  'gemini-3.1-flash-lite-preview': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: GEMINI_31_FLASH_LITE_THINKING },

  /* ── Google: Gemini 2.x legacy ───────────────────────────────────────── */
  'gemini-2.5-pro': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: GEMINI_25_PRO_THINKING },
  'gemini-2.5-flash': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: GEMINI_25_FLASH_THINKING },
  'gemini-2.0-flash': { contextWindow: 1048576, endpointType: 'generate-content', reasoningConfig: null },
};

/** Default endpoint types per provider when a model isn't in the catalog. */
const PROVIDER_ENDPOINT_DEFAULTS: Record<string, string> = {
  openai: 'chat-completions',
  'openai-compatible': 'chat-completions',
  anthropic: 'messages',
  google: 'generate-content',
};

const DISCOVERY_TIMEOUT_MS = 10000;

const providerTypeSchema = z.enum(['openai', 'anthropic', 'google', 'openai-compatible']);

const OPENAI_MODEL_PREFIXES = ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-', 'codex-'];

export class LlmDiscoveryService {
  async validateAndDiscover(
    providerType: string,
    baseUrl: string,
    apiKey: string,
  ): Promise<DiscoveredModel[]> {
    const parsed = providerTypeSchema.safeParse(providerType);
    if (!parsed.success) return [];

    try {
      return await this.discoverByType(parsed.data, baseUrl, apiKey);
    } catch {
      return [];
    }
  }

  private async discoverByType(
    providerType: 'openai' | 'anthropic' | 'google' | 'openai-compatible',
    baseUrl: string,
    apiKey: string,
  ): Promise<DiscoveredModel[]> {
    switch (providerType) {
      case 'openai': return this.discoverOpenAi(baseUrl, apiKey);
      case 'openai-compatible': return this.discoverOpenAiCompatible(baseUrl, apiKey);
      case 'anthropic': return this.discoverAnthropic(apiKey);
      case 'google': return this.discoverGoogle(apiKey);
    }
  }

  private async discoverOpenAi(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
    const response = await this.fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const body = await response.json() as { data: Array<{ id: string; created: number }> };
    return body.data
      .filter((m) => isOpenAiChatModel(m.id))
      .map((m) => enrichModel(m.id, m.id, 'openai'));
  }

  private async discoverOpenAiCompatible(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await this.fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/models`, { headers });

    const body = await response.json() as { data: Array<{ id: string; created?: number }> };
    return body.data.map((m) => enrichModel(m.id, m.id, 'openai-compatible'));
  }

  private async discoverAnthropic(apiKey: string): Promise<DiscoveredModel[]> {
    const response = await this.fetchWithTimeout('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    const body = await response.json() as {
      data: Array<{ id: string; display_name: string; created_at: string }>;
    };
    return body.data
      .filter((m) => m.id.includes('claude'))
      .map((m) => enrichModel(m.id, m.display_name, 'anthropic'));
  }

  private async discoverGoogle(apiKey: string): Promise<DiscoveredModel[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await this.fetchWithTimeout(url, {});

    const body = await response.json() as {
      models: Array<{
        name: string;
        displayName: string;
        inputTokenLimit: number;
        outputTokenLimit: number;
        supportedGenerationMethods: string[];
      }>;
    };

    return body.models
      .filter((m) => m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => {
        const modelId = m.name.replace('models/', '');
        const known = findKnownModel(modelId);
        return {
          modelId,
          displayName: m.displayName,
          contextWindow: m.inputTokenLimit ?? known?.contextWindow ?? null,
          maxOutputTokens: m.outputTokenLimit ?? null,
          endpointType: known?.endpointType ?? 'generate-content',
          reasoningConfig: known?.reasoningConfig ?? null,
        };
      });
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Discovery request failed: ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

const DEFAULT_ENABLED_PATTERNS = [
  /^gpt-5\.4(-\d|$)/,
  /^gpt-5\.3-codex/,
  /^gemini-3\.1-pro/,
  /^claude-sonnet-4-6/,
  /^claude-opus-4-6/,
];

export function isDefaultEnabledModel(modelId: string): boolean {
  return DEFAULT_ENABLED_PATTERNS.some((pattern) => pattern.test(modelId));
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/models\/?$/, '').replace(/\/+$/, '');
}

function isOpenAiChatModel(modelId: string): boolean {
  return OPENAI_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

/**
 * Find a known model entry by exact match first, then by prefix match.
 * Handles provider model IDs with date suffixes (e.g. claude-opus-4-6-20260204
 * matches catalog key claude-opus-4-6).
 */
export function findKnownModel(modelId: string): KnownModelEntry | undefined {
  if (KNOWN_MODELS[modelId]) return KNOWN_MODELS[modelId];

  for (const [key, entry] of Object.entries(KNOWN_MODELS)) {
    if (modelId.startsWith(key)) return entry;
  }
  return undefined;
}

function enrichModel(modelId: string, displayName: string, providerType: string): DiscoveredModel {
  const known = findKnownModel(modelId);
  return {
    modelId,
    displayName,
    contextWindow: known?.contextWindow ?? null,
    maxOutputTokens: null,
    endpointType: known?.endpointType ?? PROVIDER_ENDPOINT_DEFAULTS[providerType] ?? 'chat-completions',
    reasoningConfig: known?.reasoningConfig ?? null,
  };
}
