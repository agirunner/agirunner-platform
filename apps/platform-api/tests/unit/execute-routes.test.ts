import fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeRoutes } from '../../src/api/routes/execute.routes.js';

describe('execute route impossible-scope policy alignment', () => {
  let app: FastifyInstance | undefined;
  const previousExecuteRouteMode = process.env.EXECUTE_ROUTE_MODE;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousLiveAuthLlmApiBaseUrl = process.env.LIVE_AUTH_LLM_API_BASE_URL;
  const previousLiveEvaluationModel = process.env.LIVE_EVALUATION_MODEL;
  const previousLiveAuthLlmModel = process.env.LIVE_AUTH_LLM_MODEL;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }

    if (previousExecuteRouteMode === undefined) delete process.env.EXECUTE_ROUTE_MODE;
    else process.env.EXECUTE_ROUTE_MODE = previousExecuteRouteMode;

    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;

    if (previousLiveAuthLlmApiBaseUrl === undefined) delete process.env.LIVE_AUTH_LLM_API_BASE_URL;
    else process.env.LIVE_AUTH_LLM_API_BASE_URL = previousLiveAuthLlmApiBaseUrl;

    if (previousLiveEvaluationModel === undefined) delete process.env.LIVE_EVALUATION_MODEL;
    else process.env.LIVE_EVALUATION_MODEL = previousLiveEvaluationModel;

    if (previousLiveAuthLlmModel === undefined) delete process.env.LIVE_AUTH_LLM_MODEL;
    else process.env.LIVE_AUTH_LLM_MODEL = previousLiveAuthLlmModel;

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function createApp(): Promise<FastifyInstance> {
    app = fastify();
    app.decorate('config', {
      EXECUTE_ROUTE_MODE: process.env.EXECUTE_ROUTE_MODE ?? 'disabled',
      LIVE_EXECUTOR_API_BASE_URL: process.env.LIVE_EXECUTOR_API_BASE_URL,
      LIVE_AUTH_LLM_API_BASE_URL: process.env.LIVE_AUTH_LLM_API_BASE_URL,
      LIVE_EVALUATION_MODEL: process.env.LIVE_EVALUATION_MODEL,
      LIVE_AUTH_LLM_MODEL: process.env.LIVE_AUTH_LLM_MODEL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    } as never);
    await app.register(executeRoutes);
    return app;
  }

  it('rejects canonical impossible rewrite objectives', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-simulated';
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        title: 'Impossible migration objective',
        input: {
          goal: 'Rewrite the entire application in Rust with no JavaScript remaining',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: 'impossible_scope',
    });
  });

  it('does not reject ordinary Rust mentions without impossible constraints', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-simulated';
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        title: 'Performance enhancement task',
        input: {
          goal: 'Add a Rust benchmark module for one endpoint',
          repo: 'perf-tooling',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      execution_mode: 'simulated-not-executed',
      role: 'developer',
      simulated: true,
      authenticity_gate_hint: 'NOT_PASS',
    });
  });

  it('rejects tasks explicitly marked with deterministic impossible failure mode', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-simulated';
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        title: 'Normal objective text',
        context: {
          failure_mode: 'deterministic_impossible',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: 'impossible_scope',
    });
  });

  it('returns simulation-marked output and never emits concrete diff payload fields', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-simulated';
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'test',
        task_id: 'task-42',
        input: {
          repo: 'todo-app',
          issue: 'pagination',
          goal: 'Fix issue #123',
          instruction: 'Generate a real diff',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;

    expect(body.execution_mode).toBe('simulated-not-executed');
    expect(body.simulated).toBe(true);
    expect(body.authenticity_gate_hint).toBe('NOT_PASS');
    expect(String(body.summary)).toContain('NOT EXECUTION-BACKED');
    expect(body.patch).toBeUndefined();
    expect(body.changed_files).toBeUndefined();
    expect(body.tests).toBeUndefined();
  });

  it('captures workflow id from nested task context for traceability', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-simulated';
    const server = await createApp();

    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        context: {
          task: {
            workflow_id: 'workflow-from-task-context',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workflow_id: 'workflow-from-task-context',
      execution_mode: 'simulated-not-executed',
      authenticity_gate_hint: 'NOT_PASS',
    });
  });

  it('returns execution-backed output when execute-route mode is enabled', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-execution-backed';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LIVE_AUTH_LLM_API_BASE_URL = 'https://wrong.invalid/v1';
    process.env.LIVE_EVALUATION_MODEL = 'gpt-4.1-mini';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Implemented pagination fix with concrete code changes.',
                  implementation: [
                    'Updated pagination query builder to enforce stable cursor ordering.',
                    'Added request validation for cursor and limit boundary cases.',
                  ],
                  changed_files: [
                    {
                      path: 'apps/api/src/pagination.ts',
                      change: 'Added stable ordering and cursor normalization.',
                      reason: 'Guarantee deterministic page traversal across inserts.',
                    },
                  ],
                  patch:
                    'diff --git a/apps/api/src/pagination.ts b/apps/api/src/pagination.ts\nindex 1111111..2222222 100644\n--- a/apps/api/src/pagination.ts\n+++ b/apps/api/src/pagination.ts\n@@ -11,6 +11,8 @@ export function buildCursorQuery(...) {\n+  const stableOrder = [...];\n+  return stableOrder;\n }',
                  tests: ['pnpm --filter api test pagination --runInBand'],
                  risks: ['Requires validating behavior on large datasets in staging.'],
                  review_notes: ['Confirmed backward compatibility for existing API clients.'],
                }),
              },
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        task_id: 'task-123',
        title: 'Pagination hardening',
        context: {
          scenario: 'sdlc-happy',
          task: {
            role: 'developer',
            role_config: {
              llm_provider: 'openai',
              llm_model: 'gpt-5.4-medium',
              llm_base_url: 'https://example.invalid/v1',
            },
          },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
    expect(requestBody.model).toBe('gpt-5.4-medium');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://example.invalid/v1/chat/completions');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      task_id: 'task-123',
      execution_mode: 'live-agent-api',
      handled_by: 'platform-api-live-executor',
      tests: ['pnpm --filter api test pagination --runInBand'],
    });
  });

  it('fails closed when execution-backed mode lacks an explicit claim contract', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-execution-backed';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LIVE_AUTH_LLM_API_BASE_URL = 'https://wrong.invalid/v1';
    process.env.LIVE_EVALUATION_MODEL = 'gpt-4.1-mini';

    const server = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        task_id: 'task-no-contract',
        title: 'Pagination hardening',
        context: {
          scenario: 'sdlc-happy',
          task: {
            role: 'developer',
          },
        },
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'execute_backend_unavailable',
      message: expect.stringContaining('explicit llm_provider'),
    });
  });

  it('fails closed when execution-backed output contains placeholder markers', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-execution-backed';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LIVE_AUTH_LLM_API_BASE_URL = 'https://wrong.invalid/v1';
    process.env.LIVE_EVALUATION_MODEL = 'gpt-4.1-mini';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Implemented pagination fix.',
                  implementation: [
                    'Updated pagination query builder to enforce stable cursor ordering.',
                    'Added request validation for cursor and limit boundary cases.',
                  ],
                  changed_files: [
                    {
                      path: 'apps/api/src/pagination.ts',
                      change: 'Added stable ordering and cursor normalization.',
                      reason: 'Guarantee deterministic page traversal across inserts.',
                    },
                  ],
                  patch:
                    'diff --git a/apps/api/src/pagination.ts b/apps/api/src/pagination.ts\nindex 1111111..2222222 100644\n--- a/apps/api/src/pagination.ts\n+++ b/apps/api/src/pagination.ts\n@@ -11,6 +11,8 @@ export function buildCursorQuery(...) {\n+  const stableOrder = [...];\n+  return stableOrder;\n }',
                  tests: ['pnpm --filter api test {{placeholder}} pagination'],
                  risks: ['Requires validating behavior on large datasets in staging.'],
                  review_notes: ['Confirmed backward compatibility for existing API clients.'],
                }),
              },
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        task_id: 'task-124',
        title: 'Pagination hardening',
        context: {
          scenario: 'sdlc-happy',
          task: {
            role: 'developer',
            role_config: {
              llm_provider: 'openai',
              llm_model: 'gpt-5.4-medium',
              llm_base_url: 'https://example.invalid/v1',
            },
          },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(502);
    expect(response.json()).toMatchObject({
      error: 'execute_backend_failed',
    });
    expect(response.json().message).toContain('disallowed placeholder marker');
    expect(response.json().message).toContain('tests[0]');
  });

  it('does not fail closed for ordinary prose that mentions placeholders', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-execution-backed';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.LIVE_AUTH_LLM_API_BASE_URL = 'https://wrong.invalid/v1';
    process.env.LIVE_EVALUATION_MODEL = 'gpt-4.1-mini';

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Replaced the placeholder navigation copy with a concrete settings route.',
                  implementation: [
                    'Removed the placeholder navigation label and wired a real settings link.',
                    'Added a profile editing screen with concrete field handling.',
                  ],
                  changed_files: [
                    {
                      path: 'src/App.jsx',
                      change: 'Updated navigation and route definitions.',
                      reason: 'Replace placeholder navigation copy with the actual settings route.',
                    },
                  ],
                  patch:
                    'diff --git a/src/App.jsx b/src/App.jsx\nindex 1111111..2222222 100644\n--- a/src/App.jsx\n+++ b/src/App.jsx\n@@ -1,3 +1,5 @@\n+import SettingsPage from \"./SettingsPage\";\n+// concrete route wiring\n',
                  tests: ['Manual test: confirm placeholder copy is gone from navigation.'],
                  risks: ['Low risk: touches only route wiring and settings navigation.'],
                  review_notes: ['Placeholder wording in legacy docs may still need cleanup.'],
                }),
              },
            },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const server = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        task_id: 'task-125',
        title: 'Settings page implementation',
        context: {
          scenario: 'sdlc-happy',
          task: {
            role: 'developer',
            role_config: {
              llm_provider: 'openai',
              llm_model: 'gpt-5.4-medium',
              llm_base_url: 'https://example.invalid/v1',
            },
          },
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      task_id: 'task-125',
      execution_mode: 'live-agent-api',
    });
  });

  it('fails closed when execution-backed mode is enabled without OPENAI_API_KEY', async () => {
    process.env.EXECUTE_ROUTE_MODE = 'test-execution-backed';
    delete process.env.OPENAI_API_KEY;

    const server = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        task_id: 'task-closed-1',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'execute_backend_unavailable',
    });
  });

  it('fails closed when the compatibility route is not explicitly enabled', async () => {
    delete process.env.EXECUTE_ROUTE_MODE;

    const server = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/execute',
      payload: {
        type: 'code',
        task_id: 'task-disabled-1',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'execute_route_disabled',
    });
  });
});
