import { z } from 'zod';

import {
  type NativeSearchCapability,
  type ReasoningConfig,
  MODEL_CATALOG,
  findCatalogEntry,
  PROVIDER_ENDPOINT_DEFAULTS,
  isDefaultEnabledModel,
  readNativeSearchCapability,
} from '../../catalogs/model-catalog.js';

export type { NativeSearchCapability, ReasoningConfig };
export { MODEL_CATALOG, findCatalogEntry, isDefaultEnabledModel, readNativeSearchCapability };

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  endpointType: string;
  supportsToolUse: boolean;
  supportsVision: boolean;
  inputCostPerMillionUsd: number | null;
  outputCostPerMillionUsd: number | null;
  reasoningConfig: ReasoningConfig | null;
  nativeSearch?: NativeSearchCapability | null;
}

const providerTypeSchema = z.enum(['openai', 'anthropic', 'google', 'openai-compatible']);

const OPENAI_MODEL_PREFIXES = ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-', 'codex-'];
const OPENAI_OAUTH_ONLY_MODEL_IDS = new Set(['gpt-5.3-codex-spark']);

const DISCOVERY_TIMEOUT_MS = 10000;

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
      .filter((model) => isOpenAiChatModel(model.id))
      .filter((model) => !isOAuthOnlyOpenAiModel(model.id))
      .map((model) => enrichModel(model.id, model.id, 'openai'));
  }

  private async discoverOpenAiCompatible(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await this.fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/models`, { headers });

    const body = await response.json() as { data: Array<{ id: string; created?: number }> };
    return body.data
      .filter((model) => !isOAuthOnlyOpenAiModel(model.id))
      .map((model) => enrichModel(model.id, model.id, 'openai-compatible'));
  }

  private async discoverAnthropic(apiKey: string): Promise<DiscoveredModel[]> {
    const response = await this.fetchWithTimeout('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    const body = await response.json() as {
      data: Array<{
        id: string;
        display_name: string;
        created_at: string;
        max_input_tokens?: number;
        max_tokens?: number;
      }>;
    };
    return body.data
      .filter((model) => model.id.includes('claude'))
      .map((model) => {
        const known = findCatalogEntry(model.id);
        return {
          modelId: model.id,
          displayName: model.display_name,
          contextWindow: model.max_input_tokens ?? known?.contextWindow ?? null,
          maxOutputTokens: model.max_tokens ?? known?.maxOutputTokens ?? null,
          endpointType: known?.endpointType ?? 'messages',
          supportsToolUse: known?.supportsToolUse ?? true,
          supportsVision: known?.supportsVision ?? true,
          inputCostPerMillionUsd: known?.inputCostPerMillionUsd ?? null,
          outputCostPerMillionUsd: known?.outputCostPerMillionUsd ?? null,
          reasoningConfig: known?.reasoningConfig ?? null,
          nativeSearch: known?.nativeSearch ?? null,
        };
      });
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
      .filter((model) => model.supportedGenerationMethods.includes('generateContent'))
      .map((model) => {
        const modelId = model.name.replace('models/', '');
        const known = findCatalogEntry(modelId);
        return {
          modelId,
          displayName: model.displayName,
          contextWindow: model.inputTokenLimit ?? known?.contextWindow ?? null,
          maxOutputTokens: model.outputTokenLimit ?? known?.maxOutputTokens ?? null,
          endpointType: known?.endpointType ?? 'generate-content',
          supportsToolUse: known?.supportsToolUse ?? true,
          supportsVision: known?.supportsVision ?? true,
          inputCostPerMillionUsd: known?.inputCostPerMillionUsd ?? null,
          outputCostPerMillionUsd: known?.outputCostPerMillionUsd ?? null,
          reasoningConfig: known?.reasoningConfig ?? null,
          nativeSearch: known?.nativeSearch ?? null,
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

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/models\/?$/, '').replace(/\/+$/, '');
}

function isOpenAiChatModel(modelId: string): boolean {
  return OPENAI_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

function isOAuthOnlyOpenAiModel(modelId: string): boolean {
  return OPENAI_OAUTH_ONLY_MODEL_IDS.has(modelId);
}

function enrichModel(modelId: string, displayName: string, providerType: string): DiscoveredModel {
  const known = findCatalogEntry(modelId);
  return {
    modelId,
    displayName,
    contextWindow: known?.contextWindow ?? null,
    maxOutputTokens: known?.maxOutputTokens ?? null,
    endpointType: known?.endpointType ?? PROVIDER_ENDPOINT_DEFAULTS[providerType] ?? 'chat-completions',
    supportsToolUse: known?.supportsToolUse ?? true,
    supportsVision: known?.supportsVision ?? false,
    inputCostPerMillionUsd: known?.inputCostPerMillionUsd ?? null,
    outputCostPerMillionUsd: known?.outputCostPerMillionUsd ?? null,
    reasoningConfig: known?.reasoningConfig ?? null,
    nativeSearch: readNativeSearchCapability(modelId),
  };
}
