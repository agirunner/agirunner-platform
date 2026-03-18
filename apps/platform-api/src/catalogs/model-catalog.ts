/**
 * Unified model catalog — single source of truth for all LLM model metadata.
 *
 * Every model entry carries the full set of fields needed by the platform DB,
 * the runtime, and the dashboard. Provider discovery APIs return only model IDs;
 * this catalog provides the specs that APIs don't expose.
 */

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface ReasoningConfig {
  type: 'reasoning_effort' | 'effort' | 'thinking_level' | 'thinking_budget';
  options?: string[];
  min?: number;
  max?: number;
  default: string | number;
}

export interface ModelCatalogEntry {
  contextWindow: number;
  maxOutputTokens: number;
  endpointType: string;
  supportsToolUse: boolean;
  supportsVision: boolean;
  inputCostPerMillionUsd: number | null;
  outputCostPerMillionUsd: number | null;
  reasoningConfig: ReasoningConfig | null;
}

/* ── Reasoning config presets ──────────────────────────────────────────── */

const OAI_GPT5_REASONING: ReasoningConfig = {
  type: 'reasoning_effort', options: ['minimal', 'low', 'medium', 'high'], default: 'medium',
};
const OAI_GPT5_PRO_REASONING: ReasoningConfig = {
  type: 'reasoning_effort', options: ['high'], default: 'high',
};
const OAI_O_SERIES: ReasoningConfig = {
  type: 'reasoning_effort', options: ['low', 'medium', 'high'], default: 'medium',
};
const OAI_GPT51_REASONING: ReasoningConfig = {
  type: 'reasoning_effort', options: ['none', 'low', 'medium', 'high'], default: 'medium',
};
const OAI_XHIGH: ReasoningConfig = {
  type: 'reasoning_effort', options: ['low', 'medium', 'high', 'xhigh'], default: 'medium',
};
const OAI_GPT52_REASONING: ReasoningConfig = {
  type: 'reasoning_effort', options: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], default: 'none',
};
const OAI_GPT54_REASONING: ReasoningConfig = {
  type: 'reasoning_effort', options: ['none', 'low', 'medium', 'high', 'xhigh'], default: 'none',
};
const OAI_GPT54_PRO_REASONING: ReasoningConfig = {
  type: 'reasoning_effort', options: ['medium', 'high', 'xhigh'], default: 'medium',
};

const ANTH_OPUS_46: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high', 'max'], default: 'high',
};
const ANTH_SONNET_46: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high'], default: 'high',
};
const ANTH_OPUS_45: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high'], default: 'high',
};
const ANTH_SONNET_45: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high'], default: 'high',
};
const ANTH_OPUS_41: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high'], default: 'high',
};
const ANTH_SONNET_4: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high'], default: 'high',
};
const ANTH_OPUS_4: ReasoningConfig = {
  type: 'effort', options: ['low', 'medium', 'high'], default: 'high',
};

const GEM_31_PRO: ReasoningConfig = {
  type: 'thinking_level', options: ['low', 'medium', 'high'], default: 'high',
};
const GEM_3_PRO: ReasoningConfig = {
  type: 'thinking_level', options: ['low', 'high'], default: 'high',
};
const GEM_3_FLASH: ReasoningConfig = {
  type: 'thinking_level', options: ['minimal', 'low', 'medium', 'high'], default: 'high',
};
const GEM_31_FLASH_LITE: ReasoningConfig = {
  type: 'thinking_level', options: ['minimal', 'low', 'medium', 'high'], default: 'high',
};
const GEM_25_PRO: ReasoningConfig = {
  type: 'thinking_budget', min: 128, max: 32768, default: 0,
};
const GEM_25_FLASH: ReasoningConfig = {
  type: 'thinking_budget', min: 0, max: 24576, default: 0,
};

/* ── Factory (keeps entries compact) ───────────────────────────────────── */

function m(
  contextWindow: number, maxOutputTokens: number, endpointType: string,
  supportsToolUse: boolean, supportsVision: boolean,
  inputCostPerMillionUsd: number | null, outputCostPerMillionUsd: number | null,
  reasoningConfig: ReasoningConfig | null,
): ModelCatalogEntry {
  return {
    contextWindow, maxOutputTokens, endpointType,
    supportsToolUse, supportsVision,
    inputCostPerMillionUsd, outputCostPerMillionUsd,
    reasoningConfig,
  };
}

/* ── Catalog ───────────────────────────────────────────────────────────── */

export const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
  /* OpenAI: GPT-5.4 */
  'gpt-5.4-pro':        m(1050000, 128000, 'responses', true, true, 30,    180,   OAI_GPT54_PRO_REASONING),
  'gpt-5.4':            m(1050000, 128000, 'responses', true, true, 2.5,   15,    OAI_GPT54_REASONING),
  'gpt-5.4-mini':       m(400000,  128000, 'responses', true, true, 0.75,  4.5,   OAI_GPT54_REASONING),
  'gpt-5.4-nano':       m(400000,  128000, 'responses', true, true, 0.20,  1.60,  OAI_GPT54_REASONING),
  /* OpenAI: GPT-5.3 */
  'gpt-5.3-codex':      m(400000,  128000, 'responses', true, true, 1.75,  14,    OAI_XHIGH),
  'gpt-5.3-codex-spark':m(272000,  128000, 'responses', true, false, null, null,  null),
  /* OpenAI: GPT-5.2 */
  'gpt-5.2':            m(1050000, 128000, 'responses', true, true, 1.75,  14,    OAI_GPT52_REASONING),
  'gpt-5.2-pro':        m(1050000, 128000, 'responses', true, true, 10.5,  84,    OAI_XHIGH),
  'gpt-5.2-codex':      m(1050000, 128000, 'responses', true, true, 1.75,  14,    OAI_XHIGH),
  /* OpenAI: GPT-5.1 */
  'gpt-5.1-codex-max':  m(1050000, 128000, 'responses', true, true, 1.25,  10,    OAI_XHIGH),
  'gpt-5.1-codex':      m(1050000, 128000, 'responses', true, true, 1.25,  10,    OAI_O_SERIES),
  'gpt-5.1':            m(1050000, 128000, 'responses', true, true, 1.25,  10,    OAI_GPT51_REASONING),
  /* OpenAI: GPT-5 */
  'gpt-5-pro':          m(1050000, 128000, 'responses', true, true, 15,    120,   OAI_GPT5_PRO_REASONING),
  'gpt-5':              m(1050000, 128000, 'responses', true, true, 1.25,  10,    OAI_GPT5_REASONING),
  'gpt-5-codex':        m(1050000, 128000, 'responses', true, true, 1.25,  10,    OAI_O_SERIES),
  'gpt-5-mini':         m(400000,  128000, 'responses', true, true, 0.25,  2,     OAI_GPT5_REASONING),
  'gpt-5-nano':         m(1050000, 128000, 'responses', true, true, 0.05,  0.4,   OAI_GPT5_REASONING),
  'gpt-5-codex-mini':   m(262144,  128000, 'responses', true, false, null, null,  OAI_XHIGH),
  /* OpenAI: GPT-4.1 */
  'gpt-4.1':            m(1047576, 32768,  'chat-completions', true, true, 2,     8,     null),
  'gpt-4.1-mini':       m(1047576, 32768,  'chat-completions', true, true, 0.4,   1.6,   null),
  'gpt-4.1-nano':       m(1047576, 32768,  'chat-completions', true, true, 0.1,   0.4,   null),
  /* OpenAI: GPT-4o */
  'gpt-4o':             m(128000,  16384,  'chat-completions', true, true, 2.5,   10,    null),
  'gpt-4o-mini':        m(128000,  16384,  'chat-completions', true, true, 0.15,  0.6,   null),
  'chatgpt-4o':         m(128000,  16384,  'chat-completions', true, true, 2.5,   10,    null),
  /* OpenAI: GPT-4 Turbo / GPT-4 */
  'gpt-4-turbo':        m(128000,  4096,   'chat-completions', true, true, 10,    30,    null),
  'gpt-4':              m(8192,    8192,   'chat-completions', true, true, 30,    60,    null),
  /* OpenAI: GPT-3.5 */
  'gpt-3.5-turbo':      m(16385,   4096,   'chat-completions', true, false, 0.5,  1.5,   null),
  /* OpenAI: o-series */
  'o4-mini':            m(200000,  100000, 'responses', true, true, 1.1,   4.4,   OAI_O_SERIES),
  'o3':                 m(200000,  100000, 'responses', true, true, 2,     8,     OAI_O_SERIES),
  'o3-pro':             m(200000,  100000, 'responses', true, true, 20,    80,    OAI_O_SERIES),
  'o3-mini':            m(200000,  100000, 'responses', true, true, 1.1,   4.4,   OAI_O_SERIES),
  'o1':                 m(200000,  100000, 'responses', true, true, 15,    60,    OAI_O_SERIES),
  'o1-pro':             m(200000,  100000, 'responses', true, true, 150,   600,   OAI_O_SERIES),
  'o1-mini':            m(128000,  65536,  'chat-completions', true, true, 1.1, 4.4, OAI_O_SERIES),

  /* Anthropic: Claude 4.6 */
  'claude-opus-4-6':    m(200000,  128000, 'messages', true, true, 5,     25,    ANTH_OPUS_46),
  'claude-sonnet-4-6':  m(200000,  64000,  'messages', true, true, 3,     15,    ANTH_SONNET_46),
  /* Anthropic: Claude 4.5 */
  'claude-opus-4-5':    m(200000,  64000,  'messages', true, true, 5,     25,    ANTH_OPUS_45),
  'claude-sonnet-4-5':  m(200000,  64000,  'messages', true, true, 3,     15,    ANTH_SONNET_45),
  /* Anthropic: Claude 4.1 */
  'claude-opus-4-1':    m(200000,  32000,  'messages', true, true, 15,    75,    ANTH_OPUS_41),
  /* Anthropic: Claude 4 */
  'claude-sonnet-4':    m(200000,  64000,  'messages', true, true, 3,     15,    ANTH_SONNET_4),
  'claude-opus-4':      m(200000,  32000,  'messages', true, true, 15,    75,    ANTH_OPUS_4),
  /* Anthropic: Claude 3.x */
  'claude-haiku-4-5':   m(200000,  64000,  'messages', true, true, 1,     5,     null),
  'claude-3-5-sonnet':  m(200000,  8192,   'messages', true, true, 3,     15,    null),
  'claude-3-5-haiku':   m(200000,  8192,   'messages', true, true, 0.8,   4,     null),
  'claude-3-opus':      m(200000,  4096,   'messages', true, true, 15,    75,    null),
  'claude-3-sonnet':    m(200000,  4096,   'messages', true, true, 3,     15,    null),
  'claude-3-haiku':     m(200000,  4096,   'messages', true, true, 0.25,  1.25,  null),

  /* Google: Gemini 3.x */
  'gemini-3.1-pro-preview':       m(1048576, 65536, 'generate-content', true, true, 2,    12,   GEM_31_PRO),
  'gemini-3-pro-preview':         m(1048576, 65536, 'generate-content', true, true, 2,    12,   GEM_3_PRO),
  'gemini-3-flash-preview':       m(1048576, 65536, 'generate-content', true, true, 0.5,  3,    GEM_3_FLASH),
  'gemini-3.1-flash-lite-preview':m(1048576, 65536, 'generate-content', true, true, 0.25, 1.5,  GEM_31_FLASH_LITE),
  /* Google: Gemini 2.x legacy */
  'gemini-2.5-pro':    m(1048576, 65536,  'generate-content', true, true, 1.25,  10,    GEM_25_PRO),
  'gemini-2.5-flash':  m(1048576, 65536,  'generate-content', true, true, 0.3,   2.5,   GEM_25_FLASH),
  'gemini-2.0-flash':  m(1048576, 8192,   'generate-content', true, true, 0.1,   0.4,   null),
};

/* ── Lookup ────────────────────────────────────────────────────────────── */

/**
 * Find a catalog entry by exact match first, then by longest prefix match.
 * Handles provider model IDs with date suffixes (e.g. claude-opus-4-6-20260204
 * matches catalog key claude-opus-4-6).
 */
export function findCatalogEntry(modelId: string): ModelCatalogEntry | undefined {
  if (MODEL_CATALOG[modelId]) return MODEL_CATALOG[modelId];

  let bestMatch: ModelCatalogEntry | undefined;
  let bestLen = 0;
  for (const [key, entry] of Object.entries(MODEL_CATALOG)) {
    if (modelId.startsWith(key) && key.length > bestLen) {
      bestMatch = entry;
      bestLen = key.length;
    }
  }
  return bestMatch;
}

/* ── Provider defaults ─────────────────────────────────────────────────── */

export const PROVIDER_ENDPOINT_DEFAULTS: Record<string, string> = {
  openai: 'chat-completions',
  'openai-compatible': 'chat-completions',
  anthropic: 'messages',
  google: 'generate-content',
};

/* ── Default-enabled patterns ──────────────────────────────────────────── */

const DEFAULT_ENABLED_PATTERNS = [
  /^gpt-5\.4($|-)/,
  /^gpt-5\.3-codex/,
  /^gemini-3\.1-pro/,
  /^claude-sonnet-4-6/,
  /^claude-opus-4-6/,
];

export function isDefaultEnabledModel(modelId: string): boolean {
  return DEFAULT_ENABLED_PATTERNS.some((pattern) => pattern.test(modelId));
}
