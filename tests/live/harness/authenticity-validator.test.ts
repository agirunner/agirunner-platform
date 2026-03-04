import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  enforceScenarioAuthenticityGate,
  resolveScenarioAuthenticityRoute,
  runDeterministicAuthenticityValidator,
  runDeterministicResilienceValidator,
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

function makeAp7Evidence(): ScenarioDeliveryEvidence {
  return {
    pipelineId: 'pipeline-ap7',
    pipelineState: 'active',
    acceptanceCriteria: ['AP-7 resilience + delivery quality split evidence'],
    requiresGitDiffEvidence: false,
    tasks: [
      {
        id: 'ap7-failed-task',
        role: 'developer',
        state: 'failed',
        output: { error: 'Impossible rewrite request failed as expected' },
      },
      {
        id: 'ap7-retried-task',
        role: 'developer',
        state: 'ready',
        output: { status: 'ready_after_retry' },
      },
    ],
  };
}

function makeAp2SyntheticEvidence(overrides?: Partial<ScenarioDeliveryEvidence>): ScenarioDeliveryEvidence {
  return {
    pipelineId: 'pipeline-ap2',
    pipelineState: 'completed',
    acceptanceCriteria: ['Deterministic synthetic signature checks for AP-2'],
    requiresGitDiffEvidence: false,
    tasks: [
      {
        id: 'ap2-task-1',
        role: 'architect',
        state: 'completed',
        output: {
          scenario: 'ap2-external-runtime',
          handled_by: 'ap2-external-worker',
          role: 'architect',
          task_id: 'ap2-task-1',
          pipeline_id: 'pipeline-ap2',
        },
      },
    ],
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

test('deterministic validator enforces synthetic signature integrity for AP-2', () => {
  const evidence = makeAp2SyntheticEvidence();
  const verdict = runDeterministicAuthenticityValidator(
    'ap2-external-runtime',
    makeResult({
      name: 'ap2-external-runtime',
      authenticityEvidence: [evidence],
    }),
    [evidence],
  );

  assert.equal(verdict.status, 'PASS');
  assert.ok(
    verdict.checks.some(
      (check) => check.checkId.startsWith('synthetic-signature.integrity') && check.status === 'PASS',
    ),
  );
});

test('deterministic validator rejects AP-2 synthetic signatures when evidence is missing', () => {
  const verdict = runDeterministicAuthenticityValidator(
    'ap2-external-runtime',
    makeResult({
      name: 'ap2-external-runtime',
      authenticityEvidence: [],
    }),
    [],
  );

  assert.equal(verdict.status, 'NOT_PASS');
  assert.ok(
    verdict.checks.some(
      (check) => check.checkId === 'synthetic-signature.evidence-present' && check.status === 'NOT_PASS',
    ),
  );
});

test('deterministic validator rejects AP-2 synthetic signatures with mismatched handler', () => {
  const evidence = makeAp2SyntheticEvidence({
    tasks: [
      {
        id: 'ap2-task-1',
        role: 'architect',
        state: 'completed',
        output: {
          scenario: 'ap2-external-runtime',
          handled_by: 'ap2-unexpected-worker',
          role: 'architect',
          task_id: 'ap2-task-1',
          pipeline_id: 'pipeline-ap2',
        },
      },
    ],
  });

  const verdict = runDeterministicAuthenticityValidator(
    'ap2-external-runtime',
    makeResult({
      name: 'ap2-external-runtime',
      authenticityEvidence: [evidence],
    }),
    [evidence],
  );

  assert.equal(verdict.status, 'NOT_PASS');
  assert.ok(
    verdict.checks.some(
      (check) => check.checkId.startsWith('synthetic-signature.integrity') && check.status === 'NOT_PASS',
    ),
  );
});

test('ap7 deterministic resilience validator rejects forbidden no_failure_within_timeout token', () => {
  const evidence = makeAp7Evidence();
  const verdict = runDeterministicResilienceValidator(
    'ap7-failure-recovery',
    makeResult({
      name: 'ap7-failure-recovery',
      validations: [
        'template_created',
        'pipeline_created',
        'resilience_no_hang_within_timeout',
        'resilience_failed_task_observed',
        'resilience_retry_control_invoked',
        'resilience_retry_transition_ready',
        'no_failure_within_timeout',
      ],
      authenticityEvidence: [evidence],
    }),
    [evidence],
  );

  assert.ok(verdict);
  assert.equal(verdict?.status, 'NOT_PASS');
  assert.ok(
    verdict?.checks.some(
      (check) =>
        check.checkId === 'resilience.forbidden-pass-validation-absent' &&
        check.status === 'NOT_PASS',
    ),
  );
});

test('authenticity gate separates resilience and delivery-quality outcomes for AP-7', async () => {
  const evidence = makeAp7Evidence();

  const result = await enforceScenarioAuthenticityGate({
    runId: 'test-run-ap7-split',
    scenario: 'ap7-failure-recovery',
    provider: 'openai',
    template: 'sdlc',
    result: makeResult({
      name: 'ap7-failure-recovery',
      validations: [
        'template_created',
        'pipeline_created',
        'resilience_no_hang_within_timeout',
        'resilience_failed_task_observed',
        'resilience_retry_control_invoked',
        'resilience_retry_transition_ready',
        'no_failure_within_timeout',
      ],
      authenticityEvidence: [evidence],
    }),
  });

  assert.equal(result.status, 'NOT_PASS');
  assert.equal(result.resilience?.status, 'NOT_PASS');
  assert.equal(result.deliveryQualityStatus, 'PASS');
  assert.match(result.reason ?? '', /Deterministic resilience validator/);

  rmSync(path.join(process.cwd(), 'tests', 'artifacts', 'live', 'validators', 'test-run-ap7-split'), {
    recursive: true,
    force: true,
  });
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

test('llm validator normalizes known deterministic evidence-ref aliases before fail-closed checks', async () => {
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  const prevProvider = process.env.LIVE_AUTH_LLM_PROVIDER;
  const prevModel = process.env.LIVE_AUTH_LLM_MODEL;
  const prevFetch = globalThis.fetch;

  try {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LIVE_AUTH_LLM_PROVIDER = 'openai';
    process.env.LIVE_AUTH_LLM_MODEL = 'gpt-4o-mini';

    const deterministic = runDeterministicAuthenticityValidator('sdlc-happy', makeResult(), [
      makeEvidence(),
    ]);

    const mockedVerdict = {
      verdict: 'PASS',
      summary: 'Grounded output with concrete evidence.',
      checks: [
        {
          checkId: 'acceptance-structure.pipeline',
          status: 'PASS',
          rationale: 'Pipeline reached completed state.',
          evidenceRefs: ['pipeline:pipeline-1'],
        },
        {
          checkId: 'placeholder-rejection.output-markers',
          status: 'PASS',
          rationale: 'No placeholders detected.',
          evidenceRefs: ['placeholder-rejection.*:pipeline-1'],
        },
        {
          checkId: 'git-diff-linkage',
          status: 'PASS',
          rationale: 'Code diff evidence is present.',
          evidenceRefs: ['git-diff-linkage:pipeline-1'],
        },
      ],
      missingEvidenceRefs: [],
    };

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              content: JSON.stringify(mockedVerdict),
            },
          },
        ],
      }),
    })) as typeof globalThis.fetch;

    const llm = await runLlmAuthenticityValidator('sdlc-happy', deterministic, [
      {
        ref: 'pipeline:pipeline-1:state',
        location: 'pipeline-1.state',
        text: 'completed',
      },
      {
        ref: 'task:t1:output',
        location: 'pipeline-1.tasks.t1.output',
        text: 'diff --git a/src/app.js b/src/app.js',
      },
    ]);

    assert.equal(llm.status, 'PASS');
    const normalizedRefs = llm.output?.verdict.checks.flatMap((check) => check.evidenceRefs) ?? [];
    assert.ok(normalizedRefs.includes('pipeline:pipeline-1:state'));
    assert.ok(normalizedRefs.includes('task:t1:output'));
  } finally {
    if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiKey;
    if (prevProvider === undefined) delete process.env.LIVE_AUTH_LLM_PROVIDER;
    else process.env.LIVE_AUTH_LLM_PROVIDER = prevProvider;
    if (prevModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
    else process.env.LIVE_AUTH_LLM_MODEL = prevModel;
    globalThis.fetch = prevFetch;
  }
});

test('llm validator normalizes bare task refs to canonical refs when check semantics are deterministic', async () => {
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  const prevProvider = process.env.LIVE_AUTH_LLM_PROVIDER;
  const prevModel = process.env.LIVE_AUTH_LLM_MODEL;
  const prevFetch = globalThis.fetch;

  try {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LIVE_AUTH_LLM_PROVIDER = 'openai';
    process.env.LIVE_AUTH_LLM_MODEL = 'gpt-4o-mini';

    const deterministic = runDeterministicAuthenticityValidator('sdlc-happy', makeResult(), [
      makeEvidence(),
    ]);

    const mockedVerdict = {
      verdict: 'PASS',
      summary: 'Bare task refs are normalized to canonical output refs.',
      checks: [
        {
          checkId: 'acceptance-structure.completed-task-output',
          status: 'PASS',
          rationale: 'Completed task output exists.',
          evidenceRefs: ['task:t1'],
        },
        {
          checkId: 'git-diff-linkage',
          status: 'PASS',
          rationale: 'Git diff is linked through task output evidence.',
          evidenceRefs: ['task:t1'],
        },
      ],
      missingEvidenceRefs: [],
    };

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              content: JSON.stringify(mockedVerdict),
            },
          },
        ],
      }),
    })) as typeof globalThis.fetch;

    const llm = await runLlmAuthenticityValidator('sdlc-happy', deterministic, [
      {
        ref: 'pipeline:pipeline-1:state',
        location: 'pipeline-1.state',
        text: 'completed',
      },
      {
        ref: 'task:t1:state',
        location: 'pipeline-1.tasks.t1.state',
        text: 'completed',
      },
      {
        ref: 'task:t1:output',
        location: 'pipeline-1.tasks.t1.output',
        text: 'diff --git a/src/app.js b/src/app.js',
      },
    ]);

    assert.equal(llm.status, 'PASS');
    const normalizedRefs = llm.output?.verdict.checks.flatMap((check) => check.evidenceRefs) ?? [];
    assert.ok(normalizedRefs.length > 0);
    assert.ok(normalizedRefs.every((ref) => ref === 'task:t1:output'));
  } finally {
    if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiKey;
    if (prevProvider === undefined) delete process.env.LIVE_AUTH_LLM_PROVIDER;
    else process.env.LIVE_AUTH_LLM_PROVIDER = prevProvider;
    if (prevModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
    else process.env.LIVE_AUTH_LLM_MODEL = prevModel;
    globalThis.fetch = prevFetch;
  }
});

test('llm validator keeps fail-closed behavior for ambiguous bare task refs when check semantics are unknown', async () => {
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  const prevProvider = process.env.LIVE_AUTH_LLM_PROVIDER;
  const prevModel = process.env.LIVE_AUTH_LLM_MODEL;
  const prevFetch = globalThis.fetch;

  try {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LIVE_AUTH_LLM_PROVIDER = 'openai';
    process.env.LIVE_AUTH_LLM_MODEL = 'gpt-4o-mini';

    const deterministic = runDeterministicAuthenticityValidator('sdlc-happy', makeResult(), [
      makeEvidence(),
    ]);

    const mockedVerdict = {
      verdict: 'PASS',
      summary: 'Ambiguous bare task ref should remain fail-closed for unknown checks.',
      checks: [
        {
          checkId: 'unknown-check',
          status: 'PASS',
          rationale: 'Unknown check with ambiguous ref.',
          evidenceRefs: ['task:t1'],
        },
      ],
      missingEvidenceRefs: [],
    };

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              content: JSON.stringify(mockedVerdict),
            },
          },
        ],
      }),
    })) as typeof globalThis.fetch;

    const llm = await runLlmAuthenticityValidator('sdlc-happy', deterministic, [
      {
        ref: 'pipeline:pipeline-1:state',
        location: 'pipeline-1.state',
        text: 'completed',
      },
      {
        ref: 'task:t1:state',
        location: 'pipeline-1.tasks.t1.state',
        text: 'completed',
      },
      {
        ref: 'task:t1:output',
        location: 'pipeline-1.tasks.t1.output',
        text: 'diff --git a/src/app.js b/src/app.js',
      },
    ]);

    assert.equal(llm.status, 'NOT_PASS');
    assert.match(llm.error ?? '', /unknown evidence refs/i);
  } finally {
    if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiKey;
    if (prevProvider === undefined) delete process.env.LIVE_AUTH_LLM_PROVIDER;
    else process.env.LIVE_AUTH_LLM_PROVIDER = prevProvider;
    if (prevModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
    else process.env.LIVE_AUTH_LLM_MODEL = prevModel;
    globalThis.fetch = prevFetch;
  }
});

test('llm validator remains fail-closed for truly unmappable evidence refs', async () => {
  const prevOpenAiKey = process.env.OPENAI_API_KEY;
  const prevProvider = process.env.LIVE_AUTH_LLM_PROVIDER;
  const prevModel = process.env.LIVE_AUTH_LLM_MODEL;
  const prevFetch = globalThis.fetch;

  try {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.LIVE_AUTH_LLM_PROVIDER = 'openai';
    process.env.LIVE_AUTH_LLM_MODEL = 'gpt-4o-mini';

    const deterministic = runDeterministicAuthenticityValidator('sdlc-happy', makeResult(), [
      makeEvidence(),
    ]);

    const mockedVerdict = {
      verdict: 'PASS',
      summary: 'Unmappable evidence ref should fail closed.',
      checks: [
        {
          checkId: 'unknown-check',
          status: 'PASS',
          rationale: 'Unknown ref injected.',
          evidenceRefs: ['totally:unknown:ref'],
        },
      ],
      missingEvidenceRefs: [],
    };

    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'gpt-4o-mini',
        choices: [
          {
            message: {
              content: JSON.stringify(mockedVerdict),
            },
          },
        ],
      }),
    })) as typeof globalThis.fetch;

    const llm = await runLlmAuthenticityValidator('sdlc-happy', deterministic, [
      {
        ref: 'pipeline:pipeline-1:state',
        location: 'pipeline-1.state',
        text: 'completed',
      },
    ]);

    assert.equal(llm.status, 'NOT_PASS');
    assert.match(llm.error ?? '', /unknown evidence refs/i);
  } finally {
    if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAiKey;
    if (prevProvider === undefined) delete process.env.LIVE_AUTH_LLM_PROVIDER;
    else process.env.LIVE_AUTH_LLM_PROVIDER = prevProvider;
    if (prevModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
    else process.env.LIVE_AUTH_LLM_MODEL = prevModel;
    globalThis.fetch = prevFetch;
  }
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
