import type { FastifyInstance } from 'fastify';

import { shouldRejectImpossibleScopeTask } from '../../built-in/impossible-scope.js';

interface ExecuteRequestBody {
  task_id?: unknown;
  title?: unknown;
  type?: unknown;
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

function mapTaskTypeToRole(taskType: string | undefined): string | undefined {
  if (!taskType) return undefined;
  if (taskType === 'analysis') return 'architect';
  if (taskType === 'code') return 'developer';
  if (taskType === 'review') return 'reviewer';
  if (taskType === 'test') return 'qa';
  if (taskType === 'docs') return 'reviewer';
  return taskType;
}

function deriveRole(payload: ExecuteRequestBody): string {
  const context = asRecord(payload.context);
  const task = asRecord(context.task);

  return (
    mapTaskTypeToRole(readString(task.role)) ??
    mapTaskTypeToRole(readString(context.role)) ??
    mapTaskTypeToRole(readString(payload.type)) ??
    'developer'
  );
}

function derivePipelineId(payload: ExecuteRequestBody): string | null {
  const context = asRecord(payload.context);
  const task = asRecord(context.task);
  const pipeline = asRecord(context.pipeline);
  return (
    readString(context.pipeline_id) ??
    readString(task.pipeline_id) ??
    readString(pipeline.id) ??
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
    pipeline_id: derivePipelineId(payload),
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

function isExecutionBackedModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.EXECUTE_ROUTE_MODE?.trim().toLowerCase();
  return mode === 'execution-backed' || mode === 'live-agent-api';
}

function resolveOpenAiApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured =
    env.LIVE_EXECUTOR_API_BASE_URL?.trim() ||
    env.LIVE_AUTH_LLM_API_BASE_URL?.trim() ||
    'https://api.openai.com/v1';

  return configured.replace(/\/+$/, '');
}

function resolveOpenAiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.LIVE_EVALUATION_MODEL?.trim() || env.LIVE_AUTH_LLM_MODEL?.trim() || 'gpt-4.1-mini';
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
  { id: 'placeholder-word', regex: /\bplaceholder\b/i },
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
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required when EXECUTE_ROUTE_MODE=execution-backed (fail-closed).',
    );
  }

  const prompt = [
    'You are executing one SDLC task inside an autonomous software delivery pipeline.',
    'Return strict JSON only.',
    'Be concrete, implementation-focused, and evidence-backed.',
    'Do not use placeholders, TODO/TBD text, template tokens like {{...}}, or mock/dummy language.',
    'Output must be concise: at most 3 changed_files and one focused patch for real source files.',
    'Include at least one realistic git diff hunk in patch.',
    '',
    `Role: ${deriveRole(payload)}`,
    `Task title: ${readString(payload.title) ?? 'untitled'}`,
    `Task type: ${readString(payload.type) ?? 'task'}`,
    `Task input: ${safeStringify(payload.input)}`,
    `Task context: ${safeStringify(payload.context)}`,
  ].join('\n');

  const response = await fetch(`${resolveOpenAiApiBaseUrl(env)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveOpenAiModel(env),
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are an autonomous software engineer returning structured JSON task outputs for a pipeline worker.',
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
    pipeline_id: derivePipelineId(payload),
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
  app.get('/execute', async () => ({ status: 'ok', service: 'task-executor' }));

  app.post<{ Body: ExecuteRequestBody }>('/execute', async (request, reply) => {
    const payload = request.body ?? {};

    if (shouldFailAsImpossible(payload)) {
      return reply.status(422).send({
        error: 'impossible_scope',
        message:
          'Execution rejected: rewrite-to-rust objective exceeds live-lane scope under current constraints.',
      });
    }

    if (isExecutionBackedModeEnabled()) {
      try {
        return reply.status(200).send(await buildExecutionBackedOutput(payload));
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
