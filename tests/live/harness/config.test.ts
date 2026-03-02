import assert from 'node:assert/strict';
import test from 'node:test';

import { assertEvaluationConfig, loadConfig } from '../config.js';

test('evaluation mode defaults to deterministic with no evaluator model requirement', () => {
  const prevMode = process.env.LIVE_EVALUATION_MODE;
  const prevProvider = process.env.LIVE_EVALUATION_PROVIDER;
  const prevModel = process.env.LIVE_EVALUATION_MODEL;

  delete process.env.LIVE_EVALUATION_MODE;
  delete process.env.LIVE_EVALUATION_PROVIDER;
  delete process.env.LIVE_EVALUATION_MODEL;

  const config = loadConfig();
  assert.equal(config.evaluationMode, 'deterministic');
  assert.doesNotThrow(() => assertEvaluationConfig(config));

  if (prevMode === undefined) delete process.env.LIVE_EVALUATION_MODE;
  else process.env.LIVE_EVALUATION_MODE = prevMode;
  if (prevProvider === undefined) delete process.env.LIVE_EVALUATION_PROVIDER;
  else process.env.LIVE_EVALUATION_PROVIDER = prevProvider;
  if (prevModel === undefined) delete process.env.LIVE_EVALUATION_MODEL;
  else process.env.LIVE_EVALUATION_MODEL = prevModel;
});

test('llm evaluation mode requires explicit provider and model config', () => {
  const prevMode = process.env.LIVE_EVALUATION_MODE;
  const prevProvider = process.env.LIVE_EVALUATION_PROVIDER;
  const prevModel = process.env.LIVE_EVALUATION_MODEL;

  process.env.LIVE_EVALUATION_MODE = 'llm';
  delete process.env.LIVE_EVALUATION_PROVIDER;
  delete process.env.LIVE_EVALUATION_MODEL;

  assert.throws(() => assertEvaluationConfig(loadConfig()), /LIVE_EVALUATION_PROVIDER and LIVE_EVALUATION_MODEL/);

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
