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
  it('builds a process-first definition payload that matches the redesign contract', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.roles = [{ value: 'architect' }, { value: 'developer' }, { value: 'reviewer' }];
    draft.process_instructions =
      'Architect plans the change, developer implements it, reviewer checks every code change, and human approval is required before completion.';
    draft.entry_column_id = 'active';
    draft.columns[0].description = 'New work waiting for orchestration';
    draft.checkpoints[0].entry_criteria = 'Objective and acceptance criteria are clear.';
    draft.review_rules = [
      {
        from_role: 'developer',
        reviewed_by: 'reviewer',
        required: true,
        reject_role: 'developer',
      },
    ];
    draft.approval_rules = [{ on: 'checkpoint', checkpoint: 'deliver', required: true }];
    draft.handoff_rules = [{ from_role: 'architect', to_role: 'developer', required: true }];
    draft.orchestrator.max_iterations = '100';
    draft.orchestrator.llm_max_retries = '5';
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

    const built = buildPlaybookDefinition('planned', draft);

    expect(built).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          lifecycle: 'planned',
          process_instructions:
            'Architect plans the change, developer implements it, reviewer checks every code change, and human approval is required before completion.',
          roles: ['architect', 'developer', 'reviewer'],
          board: expect.objectContaining({
            entry_column_id: 'active',
            columns: expect.arrayContaining([
              expect.objectContaining({
                id: 'inbox',
                label: 'Inbox',
                description: 'New work waiting for orchestration',
              }),
            ]),
          }),
          checkpoints: expect.arrayContaining([
            expect.objectContaining({
              name: 'plan',
              goal: 'Clarify the objective and produce an execution plan.',
              entry_criteria: 'Objective and acceptance criteria are clear.',
            }),
            expect.objectContaining({
              name: 'deliver',
              human_gate: true,
            }),
          ]),
          review_rules: expect.arrayContaining([
            expect.objectContaining({
              from_role: 'developer',
              reviewed_by: 'reviewer',
              required: true,
              on_reject: { action: 'return_to_role', role: 'developer' },
            }),
          ]),
          approval_rules: expect.arrayContaining([
            expect.objectContaining({
              on: 'checkpoint',
              checkpoint: 'deliver',
              approved_by: 'human',
              required: true,
            }),
          ]),
          handoff_rules: expect.arrayContaining([
            expect.objectContaining({
              from_role: 'architect',
              to_role: 'developer',
              required: true,
            }),
          ]),
          orchestrator: expect.objectContaining({
            check_interval: '5m',
            stale_threshold: '30m',
            max_rework_iterations: 5,
            max_iterations: 100,
            llm_max_retries: 5,
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
    const draft = createDefaultAuthoringDraft('ongoing');
    draft.process_instructions = 'Triage, deliver, and complete the work.';
    draft.columns[0].id = '';

    expect(buildPlaybookDefinition('ongoing', draft)).toEqual({
      ok: false,
      error: 'Add a stable column ID.',
    });

    draft.columns[0].id = 'inbox';
    draft.columns[1].id = 'inbox';
    expect(buildPlaybookDefinition('ongoing', draft)).toEqual({
      ok: false,
      error: 'Column IDs must be unique.',
    });
  });

  it('rejects invalid persisted object and list defaults before submit', () => {
    const objectDraft = createDefaultAuthoringDraft('ongoing');
    objectDraft.process_instructions = 'Triage, deliver, and complete the work.';
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

    expect(buildPlaybookDefinition('ongoing', objectDraft)).toEqual({
      ok: false,
      error: 'Object defaults must be valid structured object data.',
    });

    const arrayDraft = createDefaultAuthoringDraft('ongoing');
    arrayDraft.process_instructions = 'Triage, deliver, and complete the work.';
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

    expect(buildPlaybookDefinition('ongoing', arrayDraft)).toEqual({
      ok: false,
      error: 'Array defaults must be valid structured list data.',
    });
  });

  it('validates board columns inline while operators edit the draft', () => {
    const draft = createDefaultAuthoringDraft('planned');
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
    const draft = hydratePlaybookAuthoringDraft('ongoing', {
      process_instructions: 'Clarify, implement, review, and complete the work.',
      roles: ['developer', 'reviewer'],
      board: {
        columns: [
          { id: 'triage', label: 'Triage', description: 'Incoming work' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
        entry_column_id: 'triage',
      },
      checkpoints: [
        {
          name: 'triage',
          goal: 'Clarify incoming work',
          human_gate: false,
          entry_criteria: 'The inbound request is captured.',
        },
      ],
      review_rules: [
        {
          from_role: 'developer',
          reviewed_by: 'reviewer',
          required: true,
          on_reject: { action: 'return_to_role', role: 'developer' },
        },
      ],
      approval_rules: [{ on: 'completion', approved_by: 'human', required: true }],
      handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
      parameters: [
        {
          name: 'context',
          type: 'object',
          description: 'Additional context',
          default: { branch: 'main' },
        },
      ],
      orchestrator: {
        max_iterations: 120,
        llm_max_retries: 7,
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
    expect(draft.process_instructions).toBe('Clarify, implement, review, and complete the work.');
    expect(draft.columns[0]).toEqual(
      expect.objectContaining({ id: 'triage', label: 'Triage' }),
    );
    expect(draft.entry_column_id).toBe('triage');
    expect(draft.checkpoints[0]).toEqual(
      expect.objectContaining({ name: 'triage', entry_criteria: 'The inbound request is captured.' }),
    );
    expect(draft.review_rules[0]).toEqual(
      expect.objectContaining({
        from_role: 'developer',
        reviewed_by: 'reviewer',
        reject_role: 'developer',
      }),
    );
    expect(draft.approval_rules[0]).toEqual(
      expect.objectContaining({ on: 'completion', checkpoint: '', required: true }),
    );
    expect(draft.handoff_rules[0]).toEqual(
      expect.objectContaining({ from_role: 'developer', to_role: 'reviewer', required: true }),
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
    expect(draft.orchestrator.max_iterations).toBe('120');
    expect(draft.orchestrator.llm_max_retries).toBe('7');
    expect(draft.orchestrator.max_active_tasks).toBe('6');
    expect(draft.orchestrator.allow_parallel_work_items).toBe(false);
    expect(draft.orchestrator).not.toEqual(expect.objectContaining({ tools: expect.anything() }));
    expect(draft.runtime.specialist_pool.enabled).toBe(true);
    expect(draft.runtime.specialist_pool.max_runtimes).toBe('4');
    expect(draft.runtime.specialist_pool.image).toBe('ghcr.io/agirunner/runtime:latest');
  });

  it('inherits task loop limits until a playbook explicitly overrides them', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.process_instructions = 'Plan, implement, review, and complete the work.';

    expect(draft.orchestrator.max_iterations).toBe('');
    expect(draft.orchestrator.llm_max_retries).toBe('');

    const built = buildPlaybookDefinition('planned', draft);
    if (!built.ok) {
      throw new Error(`expected valid playbook definition, received: ${built.error}`);
    }

    expect(built.value.orchestrator).not.toEqual(
      expect.objectContaining({
        max_iterations: expect.anything(),
        llm_max_retries: expect.anything(),
      }),
    );
  });

  it('summarizes process, rules, and inputs for guided review', () => {
    const draft = createDefaultAuthoringDraft('ongoing');
    draft.process_instructions = 'Triage, implement, review, and complete the work.';
    draft.roles = [{ value: 'architect' }, { value: 'developer' }];
    draft.columns[0].is_blocked = true;
    draft.checkpoints[1].human_gate = true;
    draft.review_rules = [
      {
        from_role: 'developer',
        reviewed_by: 'reviewer',
        required: true,
        reject_role: 'developer',
      },
    ];
    draft.approval_rules = [{ on: 'completion', checkpoint: '', required: true }];
    draft.handoff_rules = [{ from_role: 'architect', to_role: 'developer', required: true }];
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
      hasProcessInstructions: true,
      roleCount: 2,
      columnCount: 5,
      blockedColumnCount: 2,
      terminalColumnCount: 1,
      checkpointCount: 2,
      gatedCheckpointCount: 1,
      reviewRuleCount: 1,
      requiredReviewRuleCount: 1,
      approvalRuleCount: 1,
      handoffRuleCount: 1,
      parameterCount: 2,
      requiredParameterCount: 1,
      secretParameterCount: 1,
      runtimeOverrideCount: 1,
    });
  });
});
