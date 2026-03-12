import type { FastifyInstance } from 'fastify';

import type { AppEnv } from '../../config/schema.js';
import { shouldRejectImpossibleScopeTask } from '../../validation/impossible-scope.js';

interface ExecuteRequestBody {
  task_id?: unknown;
  title?: unknown;
  input?: unknown;
  context?: unknown;
}

interface OpenAiTaskResult {
  summary: string;
  implementation: string[];
  changed_files: Array<{
    path: string;
    change: string;
    reason: string;
  }>;
  patch: string;
  tests: string[];
  risks: string[];
  review_notes?: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function deriveRole(payload: ExecuteRequestBody): string {
  const context = asRecord(payload.context);
  const task = asRecord(context.task);

  return (
    readString(task.role) ??
    readString(context.role) ??
    'developer'
  );
}

function deriveWorkflowId(payload: ExecuteRequestBody): string | null {
  const context = asRecord(payload.context);
  const task = asRecord(context.task);
  const workflow = asRecord(context.workflow);
  return (
    readString(context.workflow_id) ??
    readString(task.workflow_id) ??
    readString(workflow.id) ??
    null
  );
}

function deriveScenario(payload: ExecuteRequestBody): string {
  return readString(asRecord(payload.context).scenario) ?? 'sdlc-happy';
}

function buildSimulatedExecutionOutput(payload: ExecuteRequestBody): Record<string, unknown> {
  const role = deriveRole(payload);

  return {
    scenario: deriveScenario(payload),
    task_id: readString(payload.task_id) ?? 'unknown-task',
    workflow_id: deriveWorkflowId(payload),
    role,
    handled_by: 'platform-api-execute-endpoint',
    execution_mode: 'simulated-not-executed',
    simulated: true,
    authenticity_gate_hint: 'NOT_PASS',
    summary:
      'SIMULATED OUTPUT (NOT EXECUTION-BACKED): execute endpoint did not run commands, mutate repositories, or generate verifiable diff evidence.',
    evidence: {
      execution_backed: false,
      rationale:
        'Concrete code/diff output is intentionally blocked in simulation mode to prevent synthetic-evidence fake-green outcomes.',
    },
  };
}

function shouldFailAsImpossible(payload: ExecuteRequestBody): boolean {
  return shouldRejectImpossibleScopeTask(payload as Record<string, unknown>);
}

type ExecuteRouteMode = 'disabled' | 'test-simulated' | 'test-execution-backed';

type ExecuteRouteConfig = Pick<
  AppEnv,
  | 'EXECUTE_ROUTE_MODE'
  | 'LIVE_EXECUTOR_API_BASE_URL'
  | 'LIVE_AUTH_LLM_API_BASE_URL'
  | 'LIVE_EVALUATION_MODEL'
  | 'LIVE_AUTH_LLM_MODEL'
  | 'OPENAI_API_KEY'
>;

function resolveExecuteRouteMode(config: ExecuteRouteConfig): ExecuteRouteMode {
  const mode = config.EXECUTE_ROUTE_MODE?.trim().toLowerCase();

  if (mode === 'test-simulated') {
    return 'test-simulated';
  }
  if (mode === 'test-execution-backed') {
    return 'test-execution-backed';
  }
  return 'disabled';
}

function isExecuteRouteEnabled(config: ExecuteRouteConfig): boolean {
  return resolveExecuteRouteMode(config) !== 'disabled';
}

function isExecutionBackedModeEnabled(config: ExecuteRouteConfig): boolean {
  return resolveExecuteRouteMode(config) === 'test-execution-backed';
}

function resolveOpenAiApiBaseUrl(config: ExecuteRouteConfig): string {
  const configured =
    config.LIVE_EXECUTOR_API_BASE_URL?.trim() ||
    config.LIVE_AUTH_LLM_API_BASE_URL?.trim() ||
    'https://api.openai.com/v1';

  return configured.replace(/\/+$/, '');
}

function resolveOpenAiModel(config: ExecuteRouteConfig): string {
  return config.LIVE_EVALUATION_MODEL?.trim() || config.LIVE_AUTH_LLM_MODEL?.trim() || 'gpt-4.1-mini';
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normalizeChangedFiles(
  value: unknown,
): Array<{ path: string; change: string; reason: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: Array<{ path: string; change: string; reason: string }> = [];

  for (const entry of value) {
    const record = asRecord(entry);
    const pathValue = readString(record.path);
    const changeValue = readString(record.change);
    const reasonValue = readString(record.reason);

    if (pathValue && changeValue && reasonValue) {
      normalized.push({ path: pathValue, change: changeValue, reason: reasonValue });
    }
  }

  return normalized;
}

const DISALLOWED_OUTPUT_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'template-token', regex: /\{\{[^}]+\}\}/ },
  { id: 'todo-token', regex: /\bTODO\b|\bTBD\b/i },
  { id: 'replace-me', regex: /replace\s+me|<insert[^>]*>/i },
  { id: 'dummy-output', regex: /\bdummy\b|\bmock\s+output\b|lorem ipsum/i },
  { id: 'placeholder-stub', regex: /\b(?:placeholder|stub)\s+(?:text|content|implementation|code|response|output)\b/i },
];

function findDisallowedOutputMarker(text: string): string | null {
  for (const pattern of DISALLOWED_OUTPUT_PATTERNS) {
    if (pattern.regex.test(text)) {
      return pattern.id;
    }
  }

  return null;
}

function assertNoDisallowedOutputMarkers(result: OpenAiTaskResult): void {
  const scalarFields: Array<{ field: string; value: string }> = [
    { field: 'summary', value: result.summary },
    { field: 'patch', value: result.patch },
  ];

  for (const entry of scalarFields) {
    const marker = findDisallowedOutputMarker(entry.value);
    if (marker) {
      throw new Error(
        `OpenAI executor output contains disallowed placeholder marker (${marker}) in ${entry.field}`,
      );
    }
  }

  for (const [index, value] of result.implementation.entries()) {
    const marker = findDisallowedOutputMarker(value);
    if (marker) {
      throw new Error(
        `OpenAI executor output contains disallowed placeholder marker (${marker}) in implementation[${index}]`,
      );
    }
  }

  for (const [index, file] of result.changed_files.entries()) {
    for (const [field, value] of Object.entries(file)) {
      const marker = findDisallowedOutputMarker(value);
      if (marker) {
        throw new Error(
          `OpenAI executor output contains disallowed placeholder marker (${marker}) in changed_files[${index}].${field}`,
        );
      }
    }
  }

  for (const [index, value] of result.tests.entries()) {
    const marker = findDisallowedOutputMarker(value);
    if (marker) {
      throw new Error(
        `OpenAI executor output contains disallowed placeholder marker (${marker}) in tests[${index}]`,
      );
    }
  }

  for (const [index, value] of result.risks.entries()) {
    const marker = findDisallowedOutputMarker(value);
    if (marker) {
      throw new Error(
        `OpenAI executor output contains disallowed placeholder marker (${marker}) in risks[${index}]`,
      );
    }
  }

  for (const [index, value] of (result.review_notes ?? []).entries()) {
    const marker = findDisallowedOutputMarker(value);
    if (marker) {
      throw new Error(
        `OpenAI executor output contains disallowed placeholder marker (${marker}) in review_notes[${index}]`,
      );
    }
  }
}

function ensureOpenAiResult(payload: unknown): OpenAiTaskResult {
  const record = asRecord(payload);
  const summary = readString(record.summary);
  const patch = readString(record.patch);
  const implementation = normalizeStringArray(record.implementation);
  const changedFiles = normalizeChangedFiles(record.changed_files);
  const tests = normalizeStringArray(record.tests);
  const risks = normalizeStringArray(record.risks);
  const reviewNotes = normalizeStringArray(record.review_notes);

  if (!summary) {
    throw new Error('OpenAI executor output is missing summary');
  }
  if (!patch || patch.length < 20) {
    throw new Error('OpenAI executor output patch is missing or too short');
  }
  if (implementation.length < 2) {
    throw new Error('OpenAI executor output implementation evidence is insufficient');
  }
  if (changedFiles.length === 0) {
    throw new Error('OpenAI executor output changed_files is missing');
  }
  if (tests.length === 0) {
    throw new Error('OpenAI executor output tests array is missing');
  }
  if (risks.length === 0) {
    throw new Error('OpenAI executor output risks array is missing');
  }

  return {
    summary,
    patch,
    implementation,
    changed_files: changedFiles,
    tests,
    risks,
    review_notes: reviewNotes,
  };
}

async function buildExecutionBackedOutput(
  payload: ExecuteRequestBody,
  config: ExecuteRouteConfig,
): Promise<Record<string, unknown>> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when EXECUTE_ROUTE_MODE=execution-backed (fail-closed).',
    );
  }

  const prompt = [
    'You are executing one SDLC task inside an autonomous software delivery workflow.',
    'Return strict JSON only.',
    'Be concrete, implementation-focused, and evidence-backed.',
    'Do not use placeholders, TODO/TBD text, template tokens like {{...}}, or mock/dummy language.',
    'Output must be concise: at most 3 changed_files and one focused patch for real source files.',
    'Include at least one realistic git diff hunk in patch.',
    '',
    `Role: ${deriveRole(payload)}`,
    `Task title: ${readString(payload.title) ?? 'untitled'}`,
    `Task input: ${safeStringify(payload.input)}`,
    `Task context: ${safeStringify(payload.context)}`,
  ].join('\n');

  const response = await fetch(`${resolveOpenAiApiBaseUrl(config)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveOpenAiModel(config),
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are an autonomous software engineer returning structured JSON task outputs for a workflow worker.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'task_execution_output',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'summary',
              'implementation',
              'changed_files',
              'patch',
              'tests',
              'risks',
              'review_notes',
            ],
            properties: {
              summary: { type: 'string', minLength: 1, maxLength: 400 },
              implementation: {
                type: 'array',
                minItems: 2,
                maxItems: 6,
                items: { type: 'string', minLength: 1, maxLength: 220 },
              },
              changed_files: {
                type: 'array',
                minItems: 1,
                maxItems: 3,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['path', 'change', 'reason'],
                  properties: {
                    path: { type: 'string', minLength: 1, maxLength: 180 },
                    change: { type: 'string', minLength: 1, maxLength: 180 },
                    reason: { type: 'string', minLength: 1, maxLength: 220 },
                  },
                },
              },
              patch: { type: 'string', minLength: 20, maxLength: 2800 },
              tests: {
                type: 'array',
                minItems: 1,
                maxItems: 4,
                items: { type: 'string', minLength: 1, maxLength: 220 },
              },
              risks: {
                type: 'array',
                minItems: 1,
                maxItems: 4,
                items: { type: 'string', minLength: 1, maxLength: 220 },
              },
              review_notes: {
                type: 'array',
                maxItems: 4,
                items: { type: 'string', minLength: 1, maxLength: 220 },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OpenAI executor HTTP ${response.status}: ${details}`);
  }

  const parsed = safeParseJson<Record<string, unknown>>(await response.text());
  const choices = Array.isArray(parsed?.choices) ? parsed.choices : [];
  const firstChoice = choices[0];
  const message =
    firstChoice && typeof firstChoice === 'object'
      ? asRecord(firstChoice).message
      : undefined;
  const content =
    message && typeof message === 'object' ? readString(asRecord(message).content) : undefined;

  if (!content) {
    throw new Error('OpenAI executor returned empty content');
  }

  const modelOutput = ensureOpenAiResult(safeParseJson<Record<string, unknown>>(content));
  assertNoDisallowedOutputMarkers(modelOutput);

  return {
    scenario: deriveScenario(payload),
    task_id: readString(payload.task_id) ?? 'unknown-task',
    workflow_id: deriveWorkflowId(payload),
    role: deriveRole(payload),
    handled_by: 'platform-api-live-executor',
    execution_mode: 'live-agent-api',
    summary: modelOutput.summary,
    implementation: modelOutput.implementation,
    changed_files: modelOutput.changed_files,
    patch: modelOutput.patch,
    tests: modelOutput.tests,
    risks: modelOutput.risks,
    review_notes: modelOutput.review_notes,
  };
}

export async function executeRoutes(app: FastifyInstance): Promise<void> {
  const executeConfig: ExecuteRouteConfig = app.config;

  app.get('/execute', async (_request, reply) => {
    if (!isExecuteRouteEnabled(executeConfig)) {
      return reply.status(404).send({
        error: 'execute_route_disabled',
        message:
          'The /execute compatibility route is disabled outside explicit test modes. Use the runtime /api/v1/tasks endpoint instead.',
      });
    }

    return reply.status(200).send({ status: 'ok', service: 'task-executor' });
  });

  app.post<{ Body: ExecuteRequestBody }>('/execute', async (request, reply) => {
    if (!isExecuteRouteEnabled(executeConfig)) {
      return reply.status(404).send({
        error: 'execute_route_disabled',
        message:
          'The /execute compatibility route is disabled outside explicit test modes. Use the runtime /api/v1/tasks endpoint instead.',
      });
    }

    const payload = request.body ?? {};

    if (shouldFailAsImpossible(payload)) {
      return reply.status(422).send({
        error: 'impossible_scope',
        message:
          'Execution rejected: rewrite-to-rust objective exceeds live-lane scope under current constraints.',
      });
    }

    if (isExecutionBackedModeEnabled(executeConfig)) {
      try {
        return reply.status(200).send(await buildExecutionBackedOutput(payload, executeConfig));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const missingKey = message.includes('OPENAI_API_KEY is required');
        return reply.status(missingKey ? 503 : 502).send({
          error: missingKey ? 'execute_backend_unavailable' : 'execute_backend_failed',
          message,
        });
      }
    }

    return reply.status(200).send(buildSimulatedExecutionOutput(payload));
  });
}
