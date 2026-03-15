import { describe, expect, it } from 'vitest';

import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  createRuntimePoolDraft,
  hydratePlaybookAuthoringDraft,
  summarizePlaybookAuthoringDraft,
  validateParameterDrafts,
  validateBoardColumnsDraft,
  validateRoleDrafts,
} from './playbook-authoring-support.js';

describe('playbook authoring support', () => {
  it('builds a structured definition payload that matches the create playbook contract', () => {
    const draft = createDefaultAuthoringDraft('standard');
    draft.roles = [{ value: 'architect' }, { value: 'developer' }];
    draft.entry_column_id = 'doing';
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
      label: 'Workflow Goal',
      help_text: 'Describe what the workflow should accomplish',
      allowed_values: '',
    }];
    draft.runtime.specialist_pool = createRuntimePoolDraft(true);
    draft.runtime.specialist_pool.pool_mode = 'warm';
    draft.runtime.specialist_pool.max_runtimes = '3';
    draft.runtime.specialist_pool.image = 'ghcr.io/agirunner/runtime:latest';
    draft.runtime.specialist_pool.priority = '10';

    const built = buildPlaybookDefinition('standard', draft);

    expect(built).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          lifecycle: 'standard',
          roles: ['architect', 'developer'],
          board: expect.objectContaining({
            entry_column_id: 'doing',
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
            max_rework_iterations: 5,
            max_active_tasks: 4,
            max_active_tasks_per_work_item: 2,
            allow_parallel_work_items: true,
          }),
          runtime: expect.objectContaining({
            specialist_pool: expect.objectContaining({
              pool_mode: 'warm',
              max_runtimes: 3,
              image: 'ghcr.io/agirunner/runtime:latest',
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
              label: 'Workflow Goal',
              help_text: 'Describe what the workflow should accomplish',
            }),
          ]),
        }),
      }),
    );
    if (built.ok) {
      expect(built.value.orchestrator).not.toEqual(
        expect.objectContaining({ tools: expect.anything() }),
      );
      expect(built.value.runtime).not.toEqual(
        expect.objectContaining({ orchestrator_pool: expect.anything() }),
      );
      expect(built.value.runtime).not.toEqual(
        expect.objectContaining({ pool_mode: expect.anything() }),
      );
    }
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

  it('rejects invalid persisted object and list defaults before submit', () => {
    const objectDraft = createDefaultAuthoringDraft('continuous');
    objectDraft.parameters = [
      {
        name: 'context',
        type: 'object',
        required: false,
        secret: false,
        category: 'input',
        maps_to: '',
        description: '',
        default_value: '[1,2,3]',
        label: '',
        help_text: '',
        allowed_values: '',
      },
    ];

    expect(buildPlaybookDefinition('continuous', objectDraft)).toEqual({
      ok: false,
      error: 'Object defaults must be valid structured object data.',
    });

    const arrayDraft = createDefaultAuthoringDraft('continuous');
    arrayDraft.parameters = [
      {
        name: 'branches',
        type: 'array',
        required: false,
        secret: false,
        category: 'input',
        maps_to: '',
        description: '',
        default_value: '{"branch":"main"}',
        label: '',
        help_text: '',
        allowed_values: '',
      },
    ];

    expect(buildPlaybookDefinition('continuous', arrayDraft)).toEqual({
      ok: false,
      error: 'Array defaults must be valid structured list data.',
    });
  });

  it('validates board columns inline while operators edit the draft', () => {
    const draft = createDefaultAuthoringDraft('standard');
    draft.columns = [
      { id: '', label: '', description: '', is_blocked: false, is_terminal: false },
      { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
      { id: 'inbox', label: 'Doing', description: '', is_blocked: false, is_terminal: false },
    ];
    draft.entry_column_id = 'review';

    expect(validateBoardColumnsDraft(draft.columns, draft.entry_column_id)).toEqual({
      columnErrors: [
        { id: 'Add a stable column ID.', label: 'Add a column label.' },
        { id: 'Column IDs must be unique.', label: undefined },
        { id: 'Column IDs must be unique.', label: undefined },
      ],
      entryColumnError: 'Choose a valid intake column from this board.',
      blockingIssues: [
        'Add a stable column ID.',
        'Add a column label.',
        'Column IDs must be unique.',
        'Choose a valid intake column from this board.',
      ],
      isValid: false,
    });
  });

  it('validates parameter category, secret, and project mapping posture together', () => {
    expect(
      validateParameterDrafts([
        {
          name: 'git_token',
          type: 'string',
          required: false,
          secret: false,
          category: 'input',
          maps_to: 'project.credentials.git_token',
          description: '',
          default_value: '',
          label: '',
          help_text: '',
          allowed_values: '',
        },
        {
          name: 'default_branch',
          type: 'string',
          required: false,
          secret: true,
          category: 'credential',
          maps_to: 'project.settings.default_branch',
          description: '',
          default_value: '',
          label: '',
          help_text: '',
          allowed_values: '',
        },
      ]),
    ).toEqual({
      parameterErrors: [
        {
          category: 'Git token mappings should use the Credential category.',
          secret: 'Git token mappings must be marked secret.',
        },
        {
          category: 'Repository metadata mappings should use the Repository category.',
          secret: 'Repository metadata mappings cannot be marked secret.',
        },
      ],
      blockingIssues: [
        'Git token mappings should use the Credential category.',
        'Git token mappings must be marked secret.',
        'Repository metadata mappings should use the Repository category.',
        'Repository metadata mappings cannot be marked secret.',
      ],
      isValid: false,
    });
  });

  it('accepts aligned repository and credential parameter mappings', () => {
    expect(
      validateParameterDrafts([
        {
          name: 'repository_url',
          type: 'string',
          required: false,
          secret: false,
          category: 'repository',
          maps_to: 'project.repository_url',
          description: '',
          default_value: '',
          label: '',
          help_text: '',
          allowed_values: '',
        },
        {
          name: 'git_token',
          type: 'string',
          required: false,
          secret: true,
          category: 'credential',
          maps_to: 'project.credentials.git_token',
          description: '',
          default_value: '',
          label: '',
          help_text: '',
          allowed_values: '',
        },
      ]),
    ).toEqual({
      parameterErrors: [{}, {}],
      blockingIssues: [],
      isValid: true,
    });
  });

  it('flags playbook roles that are no longer active in the shared catalog', () => {
    expect(
      validateRoleDrafts(
        [{ value: 'developer' }, { value: 'legacy-role' }, { value: '' }],
        ['architect', 'developer'],
      ),
    ).toEqual({
      roleErrors: [undefined, 'Select an active role definition from the shared catalog.', undefined],
      blockingIssues: ['Select an active role definition from the shared catalog.'],
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
        entry_column_id: 'triage',
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
        tools: ['tool_search'],
      },
      runtime: {
        pool_mode: 'warm',
        pull_policy: 'always',
        orchestrator_pool: {
          max_runtimes: 2,
        },
        specialist_pool: {
          max_runtimes: 4,
          image: 'ghcr.io/agirunner/runtime:latest',
        },
      },
    });

    expect(draft.roles).toEqual([{ value: 'developer' }, { value: 'reviewer' }]);
    expect(draft.columns[0]).toEqual(
      expect.objectContaining({ id: 'triage', label: 'Triage' }),
    );
    expect(draft.entry_column_id).toBe('triage');
    expect(draft.stages[0]).toEqual(
      expect.objectContaining({ name: 'triage', involves: 'developer' }),
    );
    expect(draft.parameters[0]).toEqual(
      expect.objectContaining({
        name: 'context',
        type: 'object',
        default_value: '{\n  "branch": "main"\n}',
        label: '',
        help_text: '',
        allowed_values: '',
      }),
    );
    expect(draft.orchestrator.max_active_tasks).toBe('6');
    expect(draft.orchestrator.allow_parallel_work_items).toBe(false);
    expect(draft.orchestrator).not.toEqual(expect.objectContaining({ tools: expect.anything() }));
    expect(draft.runtime.specialist_pool.enabled).toBe(true);
    expect(draft.runtime.specialist_pool.max_runtimes).toBe('4');
    expect(draft.runtime.specialist_pool.image).toBe('ghcr.io/agirunner/runtime:latest');
  });

  it('summarizes structured authoring posture for guided review', () => {
    const draft = createDefaultAuthoringDraft('continuous');
    draft.roles = [{ value: 'architect' }, { value: 'developer' }];
    draft.columns[0].is_blocked = true;
    draft.stages[1].human_gate = true;
    draft.runtime.specialist_pool.enabled = true;
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
        label: '',
        help_text: '',
        allowed_values: '',
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
        label: '',
        help_text: '',
        allowed_values: '',
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
