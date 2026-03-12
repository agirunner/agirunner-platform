import { describe, expect, it } from 'vitest';

import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  createRuntimePoolDraft,
} from './playbook-authoring-support.js';

describe('playbook authoring support', () => {
  it('builds a structured definition payload that matches the create playbook contract', () => {
    const draft = createDefaultAuthoringDraft('standard');
    draft.roles = [{ value: 'architect' }, { value: 'developer' }];
    draft.columns[0].description = 'New work waiting for orchestration';
    draft.stages[0].involves = 'architect,developer';
    draft.parameters = [{
      name: 'goal',
      type: 'string',
      required: true,
      secret: false,
      category: 'input',
      maps_to: '',
      description: 'What to build',
      default_value: '',
    }];
    draft.runtime.shared.pool_mode = 'warm';
    draft.runtime.shared.max_runtimes = '3';
    draft.runtime.shared.image = 'ghcr.io/agirunner/runtime:latest';
    draft.runtime.orchestrator_pool = createRuntimePoolDraft(true);
    draft.runtime.orchestrator_pool.priority = '10';

    const built = buildPlaybookDefinition('standard', draft);

    expect(built).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          lifecycle: 'standard',
          roles: ['architect', 'developer'],
          board: expect.objectContaining({
            columns: expect.arrayContaining([
              expect.objectContaining({
                id: 'inbox',
                label: 'Inbox',
                description: 'New work waiting for orchestration',
              }),
            ]),
          }),
          stages: expect.arrayContaining([
            expect.objectContaining({
              name: 'plan',
              goal: 'Plan the workflow',
              involves: ['architect', 'developer'],
            }),
            expect.objectContaining({
              name: 'deliver',
              human_gate: true,
            }),
          ]),
          orchestrator: expect.objectContaining({
            check_interval: '5m',
            stale_threshold: '30m',
            max_rework_iterations: 3,
            max_active_tasks: 4,
            max_active_tasks_per_work_item: 2,
            allow_parallel_work_items: true,
          }),
          runtime: expect.objectContaining({
            pool_mode: 'warm',
            max_runtimes: 3,
            image: 'ghcr.io/agirunner/runtime:latest',
            orchestrator_pool: expect.objectContaining({
              priority: 10,
            }),
          }),
          parameters: expect.arrayContaining([
            expect.objectContaining({
              name: 'goal',
              type: 'string',
              required: true,
              category: 'input',
              description: 'What to build',
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects incomplete or duplicate structured rows before submit', () => {
    const draft = createDefaultAuthoringDraft('continuous');
    draft.columns[0].id = '';

    expect(buildPlaybookDefinition('continuous', draft)).toEqual({
      ok: false,
      error: 'Every board column needs an ID and label.',
    });

    draft.columns[0].id = 'inbox';
    draft.columns[1].id = 'inbox';
    expect(buildPlaybookDefinition('continuous', draft)).toEqual({
      ok: false,
      error: 'Board column IDs must be unique.',
    });
  });
});
