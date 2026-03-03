import assert from 'node:assert/strict';
import test from 'node:test';

import { bootstrapAgentApiEndpoint } from './agent-api-bootstrap.js';

test('bootstrap returns null when scenarios do not require built-in worker', async () => {
  const result = await bootstrapAgentApiEndpoint({
    scenarios: ['ot1-cascade'],
    provider: 'openai',
    existingUrl: undefined,
    existingApiKey: undefined,
  });

  assert.equal(result, null);
});

test('AP-7 fail-closed rejects harness fallback when AGENT_API_URL is missing', async () => {
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousAp7Guard = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'true';

  await assert.rejects(
    () =>
      bootstrapAgentApiEndpoint({
        scenarios: ['ap7-failure-recovery'],
        provider: 'openai',
      }),
    /AP-7 fail-closed: AGENT_API_URL must be explicitly configured/,
  );

  if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAi;

  if (previousAp7Guard === undefined) delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = previousAp7Guard;
});

test('AP-7 fail-closed rejects fallback when provided AGENT_API_URL is unreachable', async () => {
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousAp7Guard = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  const previousFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'true';

  globalThis.fetch = async () => {
    throw new Error('unreachable');
  };

  await assert.rejects(
    () =>
      bootstrapAgentApiEndpoint({
        scenarios: ['ap7-failure-recovery', 'sdlc-happy'],
        provider: 'openai',
        existingUrl: 'http://localhost:19001/execute',
      }),
    /AP-7 fail-closed: provided AGENT_API_URL is unreachable/,
  );

  globalThis.fetch = previousFetch;

  if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAi;

  if (previousAp7Guard === undefined) delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = previousAp7Guard;
});

test('non-AP7 built-in scenarios can still fallback to harness executor when configured URL is unreachable', async () => {
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousAp7Guard = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  const previousFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'true';

  globalThis.fetch = async () => {
    throw new Error('unreachable');
  };

  const result = await bootstrapAgentApiEndpoint({
    scenarios: ['sdlc-happy'],
    provider: 'openai',
    existingUrl: 'http://localhost:19001/execute',
  });

  assert.ok(result);
  assert.equal(result?.source, 'harness-live-executor');
  assert.equal(result?.agentApiUrl.startsWith('http://host.docker.internal:'), true);

  await result?.dispose();

  globalThis.fetch = previousFetch;

  if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAi;

  if (previousAp7Guard === undefined) delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = previousAp7Guard;
});

test('reachable provided AGENT_API_URL is used directly for AP-7', async () => {
  const previousFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response('ok', { status: 200 });

  const result = await bootstrapAgentApiEndpoint({
    scenarios: ['ap7-failure-recovery'],
    provider: 'openai',
    existingUrl: 'http://localhost:17000/execute',
    existingApiKey: 'provided-key',
  });

  assert.ok(result);
  assert.equal(result?.source, 'provided');
  assert.equal(result?.agentApiUrl, 'http://host.docker.internal:17000/execute');
  assert.equal(result?.agentApiKey, 'provided-key');

  await result?.dispose();
  globalThis.fetch = previousFetch;
});
