import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBuiltInExecutorConfigured,
  assertLiveApiKey,
  assertLiveApiKeysForMatrix,
  assertPostSetupAgentApiReachability,
  makeExecutionMatrix,
  parseArgs,
  resolveScenarios,
} from './runner.js';

test('parseArgs defaults to core lane', () => {
  const options = parseArgs([]);
  assert.equal(options.lane, 'core');
  assert.equal(options.repeat, 1);
});

test('core lane rejects provider argument', () => {
  assert.throws(
    () => parseArgs(['--provider', 'openai']),
    /--provider is not allowed in --lane core/,
  );
});

test('core lane only allows deterministic scenario set', () => {
  const options = parseArgs(['--lane', 'core', '--scenario', 'sdlc-sad']);
  assert.throws(() => resolveScenarios(options), /Scenario sdlc-sad is not allowed in core lane/);
});

test('core lane matrix always uses provider=none', () => {
  const matrix = makeExecutionMatrix(parseArgs(['--lane', 'core', '--all']));
  assert.equal(matrix.length, 1);
  assert.equal(matrix[0]?.provider, 'none');
});

test('core lane default scenarios include AP/OT/IT/SI control-plane coverage', () => {
  const options = parseArgs(['--lane', 'core']);
  const scenarios = resolveScenarios(options);

  assert.ok(scenarios.includes('sdlc-happy'));
  assert.ok(scenarios.includes('ap2-external-runtime'));
  assert.ok(scenarios.includes('ap4-mixed-workers'));
  assert.ok(scenarios.includes('maintenance-happy'));
  assert.ok(scenarios.includes('ap7-failure-recovery'));
  assert.ok(scenarios.includes('ot1-cascade'));
  assert.ok(scenarios.includes('it1-sdk'));
  assert.ok(scenarios.includes('si1-isolation'));
  assert.equal(scenarios.includes('ap6-runtime-maintenance'), false);
});

test('core --all expands to full deterministic scenario set', () => {
  const options = parseArgs(['--lane', 'core', '--all']);
  const scenarios = resolveScenarios(options);

  assert.ok(scenarios.includes('sdlc-happy'));
  assert.ok(scenarios.includes('maintenance-happy'));
  assert.ok(scenarios.includes('ap7-failure-recovery'));
  assert.ok(scenarios.includes('ap6-runtime-maintenance'));
  assert.ok(scenarios.includes('ot2-routing'));
  assert.ok(scenarios.includes('ot3-state'));
  assert.ok(scenarios.includes('it2-mcp'));
  assert.ok(scenarios.includes('it3-mcp-sse-stream'));
  assert.ok(scenarios.includes('si2-extended-isolation'));
});

test('live lane provider key check passes when key is present', () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  assert.doesNotThrow(() => assertLiveApiKey('openai'));
  if (previous === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previous;
});

test('live lane provider key check fails when key is missing', () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.throws(() => assertLiveApiKey('anthropic'), /Missing key for provider anthropic/);
  if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
});

test('live --all validates provider keys for every matrix provider', () => {
  const previousOpenAi = process.env.OPENAI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;

  process.env.OPENAI_API_KEY = 'test-openai';
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const options = parseArgs(['--lane', 'live', '--all']);
  const providers = [
    { template: 'sdlc', provider: 'openai' },
    { template: 'sdlc', provider: 'google' },
    { template: 'sdlc', provider: 'anthropic' },
    { template: 'maintenance', provider: 'openai' },
    { template: 'maintenance', provider: 'google' },
    { template: 'maintenance', provider: 'anthropic' },
  ] as const;

  assert.equal(options.all, true);
  assert.throws(
    () => assertLiveApiKeysForMatrix([...providers]),
    /Missing key for provider google/,
  );

  if (previousOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAi;
  if (previousGoogle === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = previousGoogle;
  if (previousGemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousGemini;
  if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousAnthropic;
});

test('built-in executor preflight rejects AP scenarios when AGENT_API_URL is unset', () => {
  assert.throws(
    () => assertBuiltInExecutorConfigured(['sdlc-happy'], {}),
    /require AGENT_API_URL to be configured/,
  );
});

test('built-in executor preflight allows deterministic core scenarios without AGENT_API_URL', () => {
  assert.doesNotThrow(() => assertBuiltInExecutorConfigured(['ap2-external-runtime'], {}));
});

test('built-in executor preflight passes when AGENT_API_URL is set', () => {
  assert.doesNotThrow(() =>
    assertBuiltInExecutorConfigured(['ap5-full'], {
      AGENT_API_URL: 'http://runtime:9000',
    }),
  );
});

test('AP-7 deferred local URL preflight-only fails when endpoint remains unreachable post-setup', async () => {
  await assert.rejects(
    () =>
      assertPostSetupAgentApiReachability(
        {
          agentApiBootstrap: {
            agentApiUrl: 'http://host.docker.internal:19001/execute',
            source: 'provided',
            requiresPostSetupValidation: true,
            dispose: async () => {},
          },
          preflightOnly: true,
          timeoutMs: 50,
        },
        async () => false,
      ),
    /before --preflight-only/,
  );
});

test('AP-7 deferred local URL passes post-setup validation only when endpoint becomes reachable', async () => {
  let probeCalls = 0;

  await assert.doesNotReject(() =>
    assertPostSetupAgentApiReachability(
      {
        agentApiBootstrap: {
          agentApiUrl: 'http://host.docker.internal:19001/execute',
          source: 'provided',
          requiresPostSetupValidation: true,
          dispose: async () => {},
        },
        preflightOnly: false,
        timeoutMs: 50,
      },
      async () => {
        probeCalls += 1;
        return true;
      },
    ),
  );

  assert.equal(probeCalls, 1);
});
