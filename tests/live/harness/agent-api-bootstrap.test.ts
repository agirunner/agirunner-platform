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

test('AP-7 fail-closed rejects unreachable non-local AGENT_API_URL', async () => {
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
        existingUrl: 'http://example.invalid:19001/execute',
      }),
    /AP-7 fail-closed: provided AGENT_API_URL is unreachable/,
  );

  globalThis.fetch = previousFetch;

  if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAi;

  if (previousAp7Guard === undefined) delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = previousAp7Guard;
});

test('AP-7 fail-closed defers local AGENT_API_URL reachability to stack bootstrap', async () => {
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousAp7Guard = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  const previousFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'true';

  globalThis.fetch = async () => {
    throw new Error('unreachable');
  };

  const result = await bootstrapAgentApiEndpoint({
    scenarios: ['ap7-failure-recovery', 'sdlc-happy'],
    provider: 'openai',
    existingUrl: 'http://localhost:19001/execute',
    existingApiKey: 'provided-key',
  });

  assert.ok(result);
  assert.equal(result?.source, 'provided');
  assert.equal(result?.agentApiUrl, 'http://host.docker.internal:19001/execute');
  assert.equal(result?.agentApiKey, 'provided-key');
  assert.equal(result?.requiresPostSetupValidation, true);

  await result?.dispose();

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

test('provider=none built-in scenarios bootstrap deterministic executor even when AP-7 guard is enabled', async () => {
  const previousAp7Guard = process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;

  process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = 'true';

  const result = await bootstrapAgentApiEndpoint({
    scenarios: ['sdlc-happy', 'ap7-failure-recovery'],
    provider: 'none',
  });

  assert.ok(result);
  assert.equal(result?.source, 'harness-live-executor');
  assert.equal(result?.agentApiUrl.startsWith('http://host.docker.internal:'), true);
  assert.equal(result?.agentApiKey?.startsWith('harness-deterministic-'), true);

  await result?.dispose();

  if (previousAp7Guard === undefined) delete process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL;
  else process.env.LIVE_AP7_REQUIRE_PROVIDED_AGENT_API_URL = previousAp7Guard;
});

test('deterministic executor returns concrete delivery evidence payload', async () => {
  const result = await bootstrapAgentApiEndpoint({
    scenarios: ['sdlc-happy'],
    provider: 'none',
  });

  assert.ok(result);

  const hostAccessibleUrl = new URL(result!.agentApiUrl);
  if (hostAccessibleUrl.hostname === 'host.docker.internal') {
    hostAccessibleUrl.hostname = '127.0.0.1';
  }

  const response = await fetch(hostAccessibleUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${result?.agentApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      task_id: 'task-1',
      type: 'code',
      context: { scenario: 'sdlc-happy' },
      input: { repo: 'calc-api', goal: 'Add multiply endpoint' },
    }),
  });

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    handled_by: string;
    patch: string;
    changed_files: Array<{ path: string }>;
  };
  assert.equal(payload.handled_by, 'ap-deterministic-harness-executor');
  assert.equal(payload.patch.includes('diff --git'), true);
  assert.equal(Array.isArray(payload.changed_files) && payload.changed_files.length > 0, true);

  await result?.dispose();
});
