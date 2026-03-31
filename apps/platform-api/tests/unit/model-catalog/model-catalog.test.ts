import { describe, expect, it } from 'vitest';

import {
  MODEL_CATALOG,
  findCatalogEntry,
  isDefaultEnabledModel,
  type ModelCatalogEntry,
} from '../../../src/catalogs/model-catalog.js';

describe('MODEL_CATALOG schema validation', () => {
  it('every entry has all required fields with correct types', () => {
    for (const [modelId, entry] of Object.entries(MODEL_CATALOG)) {
      expect(typeof entry.contextWindow).toBe('number');
      expect(entry.contextWindow).toBeGreaterThan(0);

      expect(typeof entry.maxOutputTokens).toBe('number');
      expect(entry.maxOutputTokens).toBeGreaterThan(0);

      expect(typeof entry.endpointType).toBe('string');
      expect(entry.endpointType.length).toBeGreaterThan(0);

      expect(typeof entry.supportsToolUse).toBe('boolean');
      expect(typeof entry.supportsVision).toBe('boolean');

      if (entry.inputCostPerMillionUsd !== null) {
        expect(typeof entry.inputCostPerMillionUsd).toBe('number');
        expect(entry.inputCostPerMillionUsd).toBeGreaterThanOrEqual(0);
      }
      if (entry.outputCostPerMillionUsd !== null) {
        expect(typeof entry.outputCostPerMillionUsd).toBe('number');
        expect(entry.outputCostPerMillionUsd).toBeGreaterThanOrEqual(0);
      }

      if (entry.reasoningConfig !== null) {
        expect(entry.reasoningConfig).toHaveProperty('type');
        expect(entry.reasoningConfig).toHaveProperty('default');
      }

      // Guard against placeholder entries missing data (use modelId in error)
      expect(modelId).toBeDefined();
    }
  });

  it('contains expected number of models', () => {
    const count = Object.keys(MODEL_CATALOG).length;
    expect(count).toBeGreaterThanOrEqual(38);
  });

  it('cost fields are either both null or both non-null', () => {
    for (const [modelId, entry] of Object.entries(MODEL_CATALOG)) {
      const hasInput = entry.inputCostPerMillionUsd !== null;
      const hasOutput = entry.outputCostPerMillionUsd !== null;
      expect(hasInput).toBe(hasOutput);
    }
  });
});

describe('findCatalogEntry', () => {
  it('returns exact match', () => {
    const entry = findCatalogEntry('gpt-4o');
    expect(entry).toBeDefined();
    expect(entry!.contextWindow).toBe(128000);
  });

  it('returns prefix match for date-suffixed model IDs', () => {
    const entry = findCatalogEntry('claude-opus-4-6-20260204');
    expect(entry).toBeDefined();
    expect(entry!.contextWindow).toBe(200000);
    expect(entry!.maxOutputTokens).toBe(128000);
  });

  it('returns longest prefix match when multiple keys match', () => {
    const entry = findCatalogEntry('gpt-5.1-codex-max-20260301');
    expect(entry).toBeDefined();
    expect(entry!.reasoningConfig).not.toBeNull();
    expect(entry!.reasoningConfig!.options).toContain('xhigh');
  });

  it('returns undefined for completely unknown model', () => {
    const entry = findCatalogEntry('totally-unknown-model');
    expect(entry).toBeUndefined();
  });
});

describe('isDefaultEnabledModel', () => {
  it('enables production models', () => {
    expect(isDefaultEnabledModel('gpt-5.4')).toBe(true);
    expect(isDefaultEnabledModel('gpt-5.4-mini')).toBe(true);
    expect(isDefaultEnabledModel('gpt-5.3-codex')).toBe(true);
    expect(isDefaultEnabledModel('claude-sonnet-4-6')).toBe(true);
    expect(isDefaultEnabledModel('claude-opus-4-6')).toBe(true);
    expect(isDefaultEnabledModel('gemini-3.1-pro-preview')).toBe(true);
  });

  it('does not enable legacy or testing models', () => {
    expect(isDefaultEnabledModel('gpt-5.3-codex-spark')).toBe(false);
    expect(isDefaultEnabledModel('gpt-4o')).toBe(false);
    expect(isDefaultEnabledModel('gpt-4o-mini')).toBe(false);
    expect(isDefaultEnabledModel('claude-haiku-4-5')).toBe(false);
    expect(isDefaultEnabledModel('gemini-2.5-flash')).toBe(false);
  });
});

describe('catalog data spot checks', () => {
  it('gpt-5.4 has correct specs', () => {
    const entry = MODEL_CATALOG['gpt-5.4'];
    expect(entry.contextWindow).toBe(1050000);
    expect(entry.maxOutputTokens).toBe(128000);
    expect(entry.endpointType).toBe('responses');
    expect(entry.inputCostPerMillionUsd).toBe(2.5);
    expect(entry.outputCostPerMillionUsd).toBe(15);
    expect(entry.reasoningConfig).not.toBeNull();
    expect(entry.reasoningConfig!.type).toBe('reasoning_effort');
  });

  it('gpt-5.4-mini has correct specs', () => {
    const entry = MODEL_CATALOG['gpt-5.4-mini'];
    expect(entry.contextWindow).toBe(400000);
    expect(entry.maxOutputTokens).toBe(128000);
    expect(entry.endpointType).toBe('responses');
    expect(entry.inputCostPerMillionUsd).toBe(0.75);
    expect(entry.outputCostPerMillionUsd).toBe(4.5);
    expect(entry.reasoningConfig).not.toBeNull();
    expect(entry.reasoningConfig!.type).toBe('reasoning_effort');
  });

  it('claude-opus-4-6 has correct specs', () => {
    const entry = MODEL_CATALOG['claude-opus-4-6'];
    expect(entry.contextWindow).toBe(200000);
    expect(entry.maxOutputTokens).toBe(128000);
    expect(entry.endpointType).toBe('messages');
    expect(entry.inputCostPerMillionUsd).toBe(5);
    expect(entry.outputCostPerMillionUsd).toBe(25);
    expect(entry.reasoningConfig!.type).toBe('effort');
    expect(entry.reasoningConfig!.options).toContain('max');
  });

  it('gemini-3.1-pro-preview has correct specs', () => {
    const entry = MODEL_CATALOG['gemini-3.1-pro-preview'];
    expect(entry.contextWindow).toBe(1048576);
    expect(entry.maxOutputTokens).toBe(65536);
    expect(entry.endpointType).toBe('generate-content');
    expect(entry.inputCostPerMillionUsd).toBe(2);
    expect(entry.outputCostPerMillionUsd).toBe(12);
    expect(entry.reasoningConfig!.type).toBe('thinking_level');
  });

  it('codex mini has null costs', () => {
    const codexMini = MODEL_CATALOG['gpt-5-codex-mini'];
    expect(codexMini).toBeDefined();
    expect(codexMini.inputCostPerMillionUsd).toBeNull();
    expect(codexMini.outputCostPerMillionUsd).toBeNull();
  });

  it('o-series models have correct reasoning config', () => {
    for (const modelId of ['o3', 'o3-pro', 'o3-mini', 'o4-mini']) {
      const entry = MODEL_CATALOG[modelId];
      expect(entry).toBeDefined();
      expect(entry.reasoningConfig).not.toBeNull();
      expect(entry.reasoningConfig!.type).toBe('reasoning_effort');
      expect(entry.reasoningConfig!.options).toEqual(['low', 'medium', 'high']);
    }
  });
});
