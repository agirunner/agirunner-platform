import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  enforceScenarioAuthenticityGate,
  resolveScenarioAuthenticityRoute,
  runDeterministicAuthenticityValidator,
  runLlmAuthenticityValidator,
} from './authenticity-validator.js';
import type { ScenarioDeliveryEvidence, ScenarioExecutionResult } from './types.js';

function makeEvidence(overrides?: Partial<ScenarioDeliveryEvidence>): ScenarioDeliveryEvidence {
  return {
    pipelineId: 'pipeline-1',
    pipelineState: 'completed',
    acceptanceCriteria: ['All tasks completed with concrete outputs'],
    requiresGitDiffEvidence: true,
    tasks: [
      {
        id: 't1',
        role: 'developer',
        state: 'completed',
        output: {
          summary: 'Implemented feature',
          diff: 'diff --git a/src/app.js b/src/app.js\n@@ -1,1 +1,2 @@\n+const multiply = (a,b)=>a*b',
        },
      },
    ],
    ...overrides,
  };
}

function makeResult(overrides?: Partial<ScenarioExecutionResult>): ScenarioExecutionResult {
  return {
    name: 'scenario',
    costUsd: 0,
    artifacts: [],
    validations: ['pipeline_completed'],
    screenshots: [],
    authenticityEvidence: [makeEvidence()],
    ...overrides,
  };
}

test('routes only audited non-deterministic scenarios to hybrid llm validator', () => {
  assert.equal(resolveScenarioAuthenticityRoute('sdlc-happy'), 'hybrid-llm');
  assert.equal(resolveScenarioAuthenticityRoute('maintenance-happy'), 'hybrid-llm');
  assert.equal(resolveScenarioAuthenticityRoute('ap7-failure-recovery'), 'hybrid-llm');
  assert.equal(resolveScenarioAuthenticityRoute('ot1-cascade'), 'deterministic');
  assert.equal(resolveScenarioAuthenticityRoute('it2-mcp'), 'deterministic');
});

test('deterministic validator rejects placeholder/template output markers', () => {
  const evidence = makeEvidence({
    requiresGitDiffEvidence: false,
    tasks: [
      {
        id: 't-placeholder',
        role: 'developer',
        state: 'completed',
        output: {
          notes: 'TODO: replace this placeholder implementation',
        },
      },
    ],
  });

  const verdict = runDeterministicAuthenticityValidator(
    'sdlc-happy',
    makeResult({ authenticityEvidence: [evidence] }),
    [evidence],
  );
  assert.equal(verdict.status, 'NOT_PASS');
  assert.ok(
    verdict.checks.some(
      (check) => check.checkId.includes('placeholder-rejection') && check.status === 'NOT_PASS',
    ),
  );
});

test('deterministic validator enforces git/diff linkage where applicable', () => {
  const evidence = makeEvidence({
    tasks: [
      {
        id: 't-no-diff',
        role: 'developer',
        state: 'completed',
        output: {
          summary: 'Implemented fix',
          details: 'Updated logic but omitted diff references',
        },
      },
    ],
  });

  const verdict = runDeterministicAuthenticityValidator(
    'sdlc-happy',
    makeResult({ authenticityEvidence: [evidence] }),
    [evidence],
  );
  assert.equal(verdict.status, 'NOT_PASS');
  assert.ok(
    verdict.checks.some(
      (check) => check.checkId.startsWith('git-diff-linkage') && check.status === 'NOT_PASS',
    ),
  );
});

test('llm validator fails closed when provider credentials are unavailable', async () => {
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  const prevProvider = process.env.LIVE_AUTH_LLM_PROVIDER;
  const prevModel = process.env.LIVE_AUTH_LLM_MODEL;

  delete process.env.OPENAI_API_KEY;
  process.env.LIVE_AUTH_LLM_PROVIDER = 'openai';
  process.env.LIVE_AUTH_LLM_MODEL = 'gpt-4o-mini';

  const deterministic = runDeterministicAuthenticityValidator('sdlc-happy', makeResult(), [
    makeEvidence(),
  ]);
  const llm = await runLlmAuthenticityValidator('sdlc-happy', deterministic, [
    {
      ref: 'task:t1:output',
      location: 'pipeline-1.tasks.t1.output',
      text: 'diff --git a/src/app.js b/src/app.js',
    },
  ]);

  assert.equal(llm.status, 'NOT_PASS');
  assert.match(llm.error ?? '', /Missing OPENAI_API_KEY/);

  if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevOpenAiKey;
  if (prevProvider === undefined) delete process.env.LIVE_AUTH_LLM_PROVIDER;
  else process.env.LIVE_AUTH_LLM_PROVIDER = prevProvider;
  if (prevModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
  else process.env.LIVE_AUTH_LLM_MODEL = prevModel;
});

test('authenticity gate writes audit artifact and blocks NOT_PASS outcomes', async () => {
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const runId = 'test-run-auth-gate';
  const scenario = 'sdlc-happy';

  const result = await enforceScenarioAuthenticityGate({
    runId,
    scenario,
    provider: 'openai',
    template: 'sdlc',
    result: makeResult({ name: scenario }),
  });

  assert.equal(result.status, 'NOT_PASS');
  assert.ok(result.artifactPath.includes(`validators/${runId}`));

  const artifactAbsolute = path.join(process.cwd(), result.artifactPath);
  assert.equal(existsSync(artifactAbsolute), true);

  const payload = JSON.parse(readFileSync(artifactAbsolute, 'utf8')) as {
    route: string;
    result: { status: string };
  };
  assert.equal(payload.route, 'hybrid-llm');
  assert.equal(payload.result.status, 'NOT_PASS');

  rmSync(path.join(process.cwd(), 'tests', 'artifacts', 'live', 'validators', runId), {
    recursive: true,
    force: true,
  });

  if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevOpenAiKey;
});
