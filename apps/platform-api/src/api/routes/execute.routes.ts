import type { FastifyInstance } from 'fastify';

import { shouldRejectImpossibleScopeTask } from '../../built-in/impossible-scope.js';

interface ExecuteRequestBody {
  task_id?: unknown;
  title?: unknown;
  type?: unknown;
  input?: unknown;
  context?: unknown;
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

export async function executeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/execute', async () => ({ status: 'ok', service: 'task-executor' }));

  app.post<{ Body: ExecuteRequestBody }>('/execute', async (request, reply) => {
    if (shouldFailAsImpossible(request.body ?? {})) {
      return reply.status(422).send({
        error: 'impossible_scope',
        message:
          'Execution rejected: rewrite-to-rust objective exceeds live-lane scope under current constraints.',
      });
    }

    return reply.status(200).send(buildSimulatedExecutionOutput(request.body ?? {}));
  });
}
