import { z } from 'zod';

import {
  type ReasoningConfig,
  type ModelCatalogEntry,
  MODEL_CATALOG,
  findCatalogEntry,
  PROVIDER_ENDPOINT_DEFAULTS,
  isDefaultEnabledModel,
} from '../catalogs/model-catalog.js';

export type { ReasoningConfig };
export { MODEL_CATALOG, findCatalogEntry, isDefaultEnabledModel };

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
}

const providerTypeSchema = z.enum(['openai', 'anthropic', 'google', 'openai-compatible']);

const OPENAI_MODEL_PREFIXES = ['gpt-', 'o1-', 'o3-', 'o4-', 'chatgpt-', 'codex-'];

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
      .map((model) => enrichModel(model.id, model.id, 'openai'));
  }

  private async discoverOpenAiCompatible(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await this.fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/models`, { headers });

    const body = await response.json() as { data: Array<{ id: string; created?: number }> };
    return body.data.map((model) => enrichModel(model.id, model.id, 'openai-compatible'));
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
      .filter((model) => model.id.includes('claude'))
      .map((model) => enrichModel(model.id, model.display_name, 'anthropic'));
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
  };
}
