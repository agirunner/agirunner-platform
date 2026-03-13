import { describe, expect, it } from 'vitest';

import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  createRuntimePoolDraft,
  hydratePlaybookAuthoringDraft,
  summarizePlaybookAuthoringDraft,
  validateBoardColumnsDraft,
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
      error: 'Add a stable column ID.',
    });

    draft.columns[0].id = 'inbox';
    draft.columns[1].id = 'inbox';
    expect(buildPlaybookDefinition('continuous', draft)).toEqual({
      ok: false,
      error: 'Column IDs must be unique.',
    });
  });

  it('validates board columns inline while operators edit the draft', () => {
    const draft = createDefaultAuthoringDraft('standard');
    draft.columns = [
      { id: '', label: '', description: '', is_blocked: false, is_terminal: false },
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'inbox', label: 'Doing', description: '', is_blocked: false, is_terminal: false },
    ];

    expect(validateBoardColumnsDraft(draft.columns)).toEqual({
      columnErrors: [
        { id: 'Add a stable column ID.', label: 'Add a column label.' },
        { id: 'Column IDs must be unique.', label: undefined },
        { id: 'Column IDs must be unique.', label: undefined },
      ],
      blockingIssues: ['Add a stable column ID.', 'Add a column label.', 'Column IDs must be unique.'],
      isValid: false,
    });
  });

  it('hydrates a structured authoring draft from an existing playbook definition', () => {
    const draft = hydratePlaybookAuthoringDraft('continuous', {
      roles: ['developer', 'reviewer'],
      board: {
        columns: [
          { id: 'triage', label: 'Triage', description: 'Incoming work' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
      },
      stages: [
        {
          name: 'triage',
          goal: 'Clarify incoming work',
          involves: ['developer'],
          human_gate: false,
        },
      ],
      parameters: [
        {
          name: 'context',
          type: 'object',
          description: 'Additional context',
          default: { branch: 'main' },
        },
      ],
      orchestrator: {
        max_active_tasks: 6,
        allow_parallel_work_items: false,
      },
      runtime: {
        pool_mode: 'warm',
        orchestrator_pool: {
          max_runtimes: 2,
        },
      },
    });

    expect(draft.roles).toEqual([{ value: 'developer' }, { value: 'reviewer' }]);
    expect(draft.columns[0]).toEqual(
      expect.objectContaining({ id: 'triage', label: 'Triage' }),
    );
    expect(draft.stages[0]).toEqual(
      expect.objectContaining({ name: 'triage', involves: 'developer' }),
    );
    expect(draft.parameters[0]).toEqual(
      expect.objectContaining({
        name: 'context',
        type: 'object',
        default_value: '{\n  "branch": "main"\n}',
      }),
    );
    expect(draft.orchestrator.max_active_tasks).toBe('6');
    expect(draft.orchestrator.allow_parallel_work_items).toBe(false);
    expect(draft.runtime.shared.pool_mode).toBe('warm');
    expect(draft.runtime.orchestrator_pool.enabled).toBe(true);
    expect(draft.runtime.orchestrator_pool.max_runtimes).toBe('2');
  });

  it('summarizes structured authoring posture for guided review', () => {
    const draft = createDefaultAuthoringDraft('continuous');
    draft.roles = [{ value: 'architect' }, { value: 'developer' }];
    draft.columns[0].is_blocked = true;
    draft.stages[1].human_gate = true;
    draft.runtime.orchestrator_pool.enabled = true;
    draft.parameters = [
      {
        name: 'ticket_id',
        type: 'string',
        required: true,
        secret: false,
        category: 'input',
        maps_to: '',
        description: '',
        default_value: '',
      },
      {
        name: 'api_token',
        type: 'string',
        required: false,
        secret: true,
        category: 'credential',
        maps_to: '',
        description: '',
        default_value: '',
      },
    ];

    expect(summarizePlaybookAuthoringDraft(draft)).toEqual({
      roleCount: 2,
      columnCount: 3,
      blockedColumnCount: 1,
      terminalColumnCount: 1,
      stageCount: 2,
      gatedStageCount: 1,
      parameterCount: 2,
      requiredParameterCount: 1,
      secretParameterCount: 1,
      runtimeOverrideCount: 1,
    });
  });
});
