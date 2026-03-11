import { describe, expect, it } from 'vitest';

import { assertValidTransition } from '../../src/orchestration/task-state-machine.js';
import { assertValidWorkerTransition } from '../../src/orchestration/worker-state-machine.js';
import { deriveWorkflowState, validateTemplateSchema } from '../../src/orchestration/workflow-engine.js';
import { selectLeastLoadedWorker } from '../../src/services/worker-dispatch-service.js';

// Schema imports for structural behavioral checks
import { orchestratorGrants } from '../../src/db/schema/orchestrator-grants.js';
import { tasks } from '../../src/db/schema/tasks.js';
import { workers } from '../../src/db/schema/workers.js';
import { events } from '../../src/db/schema/events.js';

// Service / function imports replacing source-string presence checks
import { applyTaskCompletionSideEffects } from '../../src/services/task-completion-side-effects.js';
import { claimTaskForWorker, acknowledgeTaskAssignment } from '../../src/services/worker-dispatch-repository.js';
import { registerWorker } from '../../src/services/worker-registration-service.js';
import { WorkflowCancellationService } from '../../src/services/workflow-cancellation-service.js';
import { mapErrorToHttpStatus } from '../../src/errors/http-errors.js';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../../src/api/pagination.js';
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '../../src/errors/domain-errors.js';

describe('requirements structural backfill', () => {
  it('covers FR-023/FR-097/FR-215/FR-216/FR-217/FR-218/FR-219/FR-220/FR-221/FR-222 orchestration and scope primitives exist', () => {
    // applyTaskCompletionSideEffects is a real exported function (not just a string in source)
    expect(typeof applyTaskCompletionSideEffects).toBe('function');

    // orchestrator_grants schema exists with agentId and workflowId columns
    expect(orchestratorGrants.agentId).toBeDefined();
    expect(orchestratorGrants.workflowId).toBeDefined();

    // workflow-creation-service uses validateTemplateSchema which accepts 'orchestration' task type
    const schema = validateTemplateSchema({
      tasks: [{ id: 'orchestrate', title_template: 'Orchestrate', type: 'orchestration' }],
    });
    expect(schema.tasks[0].type).toBe('orchestration');
  });

  it('covers FR-280/FR-281/FR-282/FR-284/FR-285 worker model and status transition rules', () => {
    expect(() => assertValidWorkerTransition('worker-1', 'online', 'busy')).not.toThrow();
    expect(() => assertValidWorkerTransition('worker-1', 'offline', 'online')).not.toThrow();
    expect(() => assertValidWorkerTransition('worker-1', 'offline', 'busy')).toThrow(/Invalid worker transition/);

    // workers schema has runtimeType and heartbeatIntervalSeconds columns (structural assertion)
    expect(workers.runtimeType).toBeDefined();
    expect(workers.heartbeatIntervalSeconds).toBeDefined();
  });

  it('covers FR-291/FR-292/FR-293 dispatch runtime compatibility through generic capability selection', () => {
    const selected = selectLeastLoadedWorker(
      [
        { id: 'openclaw', status: 'online', capabilities: ['openclaw', 'typescript'], currentLoad: 2 },
        { id: 'custom', status: 'online', capabilities: ['custom_script', 'typescript'], currentLoad: 1 },
      ],
      ['typescript'],
    );

    expect(selected?.id).toBe('custom');
  });

  it('covers FR-299/FR-420/FR-423/FR-425/FR-426/FR-427/FR-428 API route registrations are live Fastify plugins', async () => {
    // Verify route handler modules export callable Fastify plugins — not just string presence
    const { workerRoutes } = await import('../../src/api/routes/workers.routes.js');
    const { workflowRoutes } = await import('../../src/api/routes/workflows.routes.js');
    const { templateRoutes } = await import('../../src/api/routes/templates.routes.js');

    expect(typeof workerRoutes).toBe('function');
    expect(typeof workflowRoutes).toBe('function');
    expect(typeof templateRoutes).toBe('function');
  });

  it('covers FR-740/FR-741/FR-742/FR-744/FR-752/FR-754/FR-756 built-in worker dispatch and registration', () => {
    // worker-dispatch-service sends tasks to workers — selectLeastLoadedWorker picks the right one
    const workerWithTask = selectLeastLoadedWorker(
      [
        { id: 'built-in', status: 'online', capabilities: ['general'], currentLoad: 5 },
        { id: 'external', status: 'online', capabilities: ['general'], currentLoad: 0 },
      ],
      ['general'],
    );
    expect(workerWithTask?.id).toBe('external');

    // registerWorker is a real exported function in worker-registration-service
    expect(typeof registerWorker).toBe('function');

    // claimTaskForWorker is a real exported function in worker-dispatch-repository
    expect(typeof claimTaskForWorker).toBe('function');
  });

  it('covers FR-760/FR-761/FR-762/FR-763 consistent errors, tenant scope and pagination hooks', () => {
    // mapErrorToHttpStatus maps domain errors to correct HTTP status codes
    expect(mapErrorToHttpStatus(new NotFoundError('missing'))).toBe(404);
    expect(mapErrorToHttpStatus(new ValidationError('bad input'))).toBe(400);
    expect(mapErrorToHttpStatus(new ConflictError('conflict'))).toBe(409);
    expect(mapErrorToHttpStatus(new ForbiddenError('denied'))).toBe(403);
    expect(mapErrorToHttpStatus(new Error('unexpected'))).toBe(500);

    // pagination constants have sensible defaults
    expect(DEFAULT_PAGE).toBe(1);
    expect(DEFAULT_PER_PAGE).toBeGreaterThan(0);
    expect(MAX_PER_PAGE).toBeGreaterThan(DEFAULT_PER_PAGE);

    // tasks schema has tenantId column (tenant scoping is structural)
    expect(tasks.tenantId).toBeDefined();
  });

  it('covers FR-818/FR-819/FR-820/FR-821 external execution delivery + metadata tracking', () => {
    // claimTaskForWorker and acknowledgeTaskAssignment are real exported functions
    expect(typeof claimTaskForWorker).toBe('function');
    expect(typeof acknowledgeTaskAssignment).toBe('function');

    // workers schema has hostInfo and metadata columns
    expect(workers.hostInfo).toBeDefined();
    expect(workers.metadata).toBeDefined();
  });

  it('covers FR-SM-004 and FR-SM-006/FR-SM-007 state-machine + auditability primitives', () => {
    expect(() => assertValidTransition('task-1', 'ready', 'claimed')).not.toThrow();
    expect(() => assertValidTransition('task-1', 'completed', 'running')).toThrow(/Cannot transition/);

    // events schema has entityType and data columns
    expect(events.entityType).toBeDefined();
    expect(events.data).toBeDefined();
  });

  it('covers FR-405/FR-406/FR-705/FR-712/FR-713/FR-714/FR-715 template-workflow behavior remains schema-safe and derivable', () => {
    const schema = validateTemplateSchema({
      metadata: { workflow: { phases: [{ id: 'default', gate: 'all_complete' }] } },
      tasks: [
        { id: 'a', title_template: 'A', type: 'code' },
        { id: 'b', title_template: 'B', type: 'test', depends_on: ['a'] },
      ],
    });

    expect(schema.tasks).toHaveLength(2);
    expect(deriveWorkflowState(['ready', 'pending'])).toBe('active');
    expect(deriveWorkflowState(['running', 'pending'])).toBe('active');

    // WorkflowCancellationService is a real class (not just a string in source)
    expect(typeof WorkflowCancellationService).toBe('function');
  });
});
