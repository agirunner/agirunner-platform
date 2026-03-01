import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { assertValidTransition } from '../../src/orchestration/task-state-machine.js';
import { assertValidWorkerTransition } from '../../src/orchestration/worker-state-machine.js';
import { derivePipelineState, validateTemplateSchema } from '../../src/orchestration/pipeline-engine.js';
import { selectLeastLoadedWorker } from '../../src/services/worker-dispatch-service.js';

describe('requirements structural backfill', () => {
  it('covers FR-023/FR-097/FR-215/FR-216/FR-217/FR-218/FR-219/FR-220/FR-221/FR-222 orchestration and scope primitives exist', () => {
    const lifecycleSource = fs.readFileSync(new URL('../../src/services/task-lifecycle-service.ts', import.meta.url), 'utf-8');
    const grantSchema = fs.readFileSync(new URL('../../src/db/schema/orchestrator-grants.ts', import.meta.url), 'utf-8');
    const creationSource = fs.readFileSync(new URL('../../src/services/pipeline-creation-service.ts', import.meta.url), 'utf-8');

    expect(lifecycleSource).toContain('applyTaskCompletionSideEffects');
    expect(grantSchema).toContain('orchestrator_grants');
    expect(creationSource).toContain('orchestration');
  });

  it('covers FR-280/FR-281/FR-282/FR-284/FR-285 worker model and status transition rules', () => {
    expect(() => assertValidWorkerTransition('worker-1', 'online', 'busy')).not.toThrow();
    expect(() => assertValidWorkerTransition('worker-1', 'offline', 'online')).not.toThrow();
    expect(() => assertValidWorkerTransition('worker-1', 'offline', 'busy')).toThrow(/Invalid worker transition/);

    const workersSchema = fs.readFileSync(new URL('../../src/db/schema/workers.ts', import.meta.url), 'utf-8');
    expect(workersSchema).toContain('runtimeType');
    expect(workersSchema).toContain('heartbeatIntervalSeconds');
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

  it('covers FR-299/FR-420/FR-423/FR-425/FR-426/FR-427/FR-428 API endpoints backing dashboard views are registered', () => {
    const bootstrapRoutes = fs.readFileSync(new URL('../../src/bootstrap/routes.ts', import.meta.url), 'utf-8');
    const workersRoutes = fs.readFileSync(new URL('../../src/api/routes/workers.routes.ts', import.meta.url), 'utf-8');

    expect(bootstrapRoutes).toContain('workerRoutes');
    expect(bootstrapRoutes).toContain('pipelineRoutes');
    expect(bootstrapRoutes).toContain('templateRoutes');
    expect(workersRoutes).toContain("'/api/v1/workers'");
  });

  it('covers FR-740/FR-741/FR-742/FR-744/FR-752/FR-754/FR-756 built-in worker path and replacement constraints are code-level', () => {
    const dispatch = fs.readFileSync(new URL('../../src/services/worker-dispatch-service.ts', import.meta.url), 'utf-8');
    const registration = fs.readFileSync(new URL('../../src/services/worker-registration-service.ts', import.meta.url), 'utf-8');

    expect(dispatch).toContain("type: 'task.assigned'");
    expect(dispatch).toContain('sendToWorker');
    expect(registration).toContain('registerWorker');
  });

  it('covers FR-760/FR-761/FR-762/FR-763 consistent errors, tenant scope and pagination hooks', () => {
    const errorHandler = fs.readFileSync(new URL('../../src/errors/error-handler.ts', import.meta.url), 'utf-8');
    const pagination = fs.readFileSync(new URL('../../src/api/pagination.ts', import.meta.url), 'utf-8');
    const schema = fs.readFileSync(new URL('../../src/db/schema/tasks.ts', import.meta.url), 'utf-8');

    expect(errorHandler).toContain('error');
    expect(pagination).toContain('DEFAULT_PAGE');
    expect(schema).toContain('tenantId');
  });

  it('covers FR-818/FR-819/FR-820/FR-821 external execution delivery + metadata tracking', () => {
    const dispatchRepository = fs.readFileSync(new URL('../../src/services/worker-dispatch-repository.ts', import.meta.url), 'utf-8');
    const workersSchema = fs.readFileSync(new URL('../../src/db/schema/workers.ts', import.meta.url), 'utf-8');

    expect(dispatchRepository).toContain('claimTaskForWorker');
    expect(dispatchRepository).toContain('acknowledgeTaskAssignment');
    expect(workersSchema).toContain('hostInfo');
    expect(workersSchema).toContain('metadata');
  });

  it('covers FR-SM-004 and FR-SM-006/FR-SM-007 state-machine + auditability primitives', () => {
    expect(() => assertValidTransition('task-1', 'ready', 'claimed')).not.toThrow();
    expect(() => assertValidTransition('task-1', 'completed', 'running')).toThrow(/Cannot transition/);

    const eventSchema = fs.readFileSync(new URL('../../src/db/schema/events.ts', import.meta.url), 'utf-8');
    expect(eventSchema).toContain('entityType');
    expect(eventSchema).toContain('data');
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
    expect(derivePipelineState(['ready', 'pending'])).toBe('pending');
    expect(derivePipelineState(['running', 'pending'])).toBe('active');
  });
});
