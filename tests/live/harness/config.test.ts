import assert from 'node:assert/strict';
import test from 'node:test';

import { assertEvaluationConfig, loadConfig } from '../config.js';

test('evaluation mode defaults to deterministic with hybrid authenticity defaults', () => {
  const prevMode = process.env.LIVE_EVALUATION_MODE;
  const prevProvider = process.env.LIVE_EVALUATION_PROVIDER;
  const prevModel = process.env.LIVE_EVALUATION_MODEL;
  const prevAuthProvider = process.env.LIVE_AUTH_LLM_PROVIDER;
  const prevAuthModel = process.env.LIVE_AUTH_LLM_MODEL;
  const prevAuthTimeout = process.env.LIVE_AUTH_LLM_TIMEOUT_MS;
  const prevAuthBaseUrl = process.env.LIVE_AUTH_LLM_API_BASE_URL;
  const prevAuthMaxChars = process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS;
  const prevAgentApiProbeTimeout = process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS;
  const prevAp7RequireAgentApi = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;

  delete process.env.LIVE_EVALUATION_MODE;
  delete process.env.LIVE_EVALUATION_PROVIDER;
  delete process.env.LIVE_EVALUATION_MODEL;
  delete process.env.LIVE_AUTH_LLM_PROVIDER;
  delete process.env.LIVE_AUTH_LLM_MODEL;
  delete process.env.LIVE_AUTH_LLM_TIMEOUT_MS;
  delete process.env.LIVE_AUTH_LLM_API_BASE_URL;
  delete process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS;
  delete process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS;
  delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;

  const config = loadConfig();
  assert.equal(config.evaluationMode, 'deterministic');
  assert.equal(config.authenticityLlmProvider, 'openai');
  assert.equal(config.authenticityLlmModel, 'gpt-4o-mini');
  assert.equal(config.authenticityLlmTimeoutMs, 60_000);
  assert.equal(config.authenticityLlmApiBaseUrl.startsWith('https://'), true);
  assert.equal(config.authenticityLlmApiBaseUrl.endsWith('/v1'), true);
  assert.equal(config.authenticityLlmMaxEvidenceChars, 1_200);
  assert.equal(config.agentApiProbeTimeoutMs, 1_500);
  assert.equal(config.ap7RequireProvidedAgentApiUrl, true);
  assert.doesNotThrow(() => assertEvaluationConfig(config));

  if (prevMode === undefined) delete process.env.LIVE_EVALUATION_MODE;
  else process.env.LIVE_EVALUATION_MODE = prevMode;
  if (prevProvider === undefined) delete process.env.LIVE_EVALUATION_PROVIDER;
  else process.env.LIVE_EVALUATION_PROVIDER = prevProvider;
  if (prevModel === undefined) delete process.env.LIVE_EVALUATION_MODEL;
  else process.env.LIVE_EVALUATION_MODEL = prevModel;
  if (prevAuthProvider === undefined) delete process.env.LIVE_AUTH_LLM_PROVIDER;
  else process.env.LIVE_AUTH_LLM_PROVIDER = prevAuthProvider;
  if (prevAuthModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
  else process.env.LIVE_AUTH_LLM_MODEL = prevAuthModel;
  if (prevAuthTimeout === undefined) delete process.env.LIVE_AUTH_LLM_TIMEOUT_MS;
  else process.env.LIVE_AUTH_LLM_TIMEOUT_MS = prevAuthTimeout;
  if (prevAuthBaseUrl === undefined) delete process.env.LIVE_AUTH_LLM_API_BASE_URL;
  else process.env.LIVE_AUTH_LLM_API_BASE_URL = prevAuthBaseUrl;
  if (prevAuthMaxChars === undefined) delete process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS;
  else process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS = prevAuthMaxChars;
  if (prevAgentApiProbeTimeout === undefined) delete process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS;
  else process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS = prevAgentApiProbeTimeout;
  if (prevAp7RequireAgentApi === undefined)
    delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = prevAp7RequireAgentApi;
});

test('AP-7 agent API requirement is explicitly configurable', () => {
  const previous = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;

  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'false';
  assert.equal(loadConfig().ap7RequireProvidedAgentApiUrl, false);

  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'true';
  assert.equal(loadConfig().ap7RequireProvidedAgentApiUrl, true);

  if (previous === undefined) delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = previous;
});

test('llm evaluation mode requires explicit provider and model config', () => {
  const prevMode = process.env.LIVE_EVALUATION_MODE;
  const prevProvider = process.env.LIVE_EVALUATION_PROVIDER;
  const prevModel = process.env.LIVE_EVALUATION_MODEL;

  process.env.LIVE_EVALUATION_MODE = 'llm';
  delete process.env.LIVE_EVALUATION_PROVIDER;
  delete process.env.LIVE_EVALUATION_MODEL;

  assert.throws(
    () => assertEvaluationConfig(loadConfig()),
    /LIVE_EVALUATION_PROVIDER and LIVE_EVALUATION_MODEL/,
  );

  process.env.LIVE_EVALUATION_PROVIDER = 'openai';
  process.env.LIVE_EVALUATION_MODEL = 'gpt-4o-mini';

  assert.doesNotThrow(() => assertEvaluationConfig(loadConfig()));

  if (prevMode === undefined) delete process.env.LIVE_EVALUATION_MODE;
  else process.env.LIVE_EVALUATION_MODE = prevMode;
  if (prevProvider === undefined) delete process.env.LIVE_EVALUATION_PROVIDER;
  else process.env.LIVE_EVALUATION_PROVIDER = prevProvider;
  if (prevModel === undefined) delete process.env.LIVE_EVALUATION_MODEL;
  else process.env.LIVE_EVALUATION_MODEL = prevModel;
});

test('agent API probe timeout must be a positive number', () => {
  const previous = process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS;

  process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS = '0';
  assert.throws(
    () => assertEvaluationConfig(loadConfig()),
    /LIVE_AGENT_API_PROBE_TIMEOUT_MS must be a positive number/,
  );

  process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS = '2500';
  assert.doesNotThrow(() => assertEvaluationConfig(loadConfig()));

  if (previous === undefined) delete process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS;
  else process.env.LIVE_AGENT_API_PROBE_TIMEOUT_MS = previous;
});

test('hybrid authenticity config enforces base URL, positive timeout, and minimum evidence chars', () => {
  const prevTimeout = process.env.LIVE_AUTH_LLM_TIMEOUT_MS;
  const prevBaseUrl = process.env.LIVE_AUTH_LLM_API_BASE_URL;
  const prevMaxChars = process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS;

  process.env.LIVE_AUTH_LLM_API_BASE_URL = '';
  process.env.LIVE_AUTH_LLM_TIMEOUT_MS = '20000';
  process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS = '1200';
  assert.throws(
    () => assertEvaluationConfig(loadConfig()),
    /LIVE_AUTH_LLM_API_BASE_URL is required/,
  );

  process.env.LIVE_AUTH_LLM_API_BASE_URL = 'https://provider.example/v1';
  process.env.LIVE_AUTH_LLM_TIMEOUT_MS = '0';
  process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS = '100';

  assert.throws(
    () => assertEvaluationConfig(loadConfig()),
    /LIVE_AUTH_LLM_TIMEOUT_MS must be a positive number/,
  );

  process.env.LIVE_AUTH_LLM_TIMEOUT_MS = '20000';
  assert.throws(
    () => assertEvaluationConfig(loadConfig()),
    /LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS must be >= 200/,
  );

  process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS = '1200';
  assert.doesNotThrow(() => assertEvaluationConfig(loadConfig()));

  if (prevTimeout === undefined) delete process.env.LIVE_AUTH_LLM_TIMEOUT_MS;
  else process.env.LIVE_AUTH_LLM_TIMEOUT_MS = prevTimeout;
  if (prevBaseUrl === undefined) delete process.env.LIVE_AUTH_LLM_API_BASE_URL;
  else process.env.LIVE_AUTH_LLM_API_BASE_URL = prevBaseUrl;
  if (prevMaxChars === undefined) delete process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS;
  else process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS = prevMaxChars;
});
