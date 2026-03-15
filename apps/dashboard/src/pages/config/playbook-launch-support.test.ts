import { describe, expect, it } from 'vitest';

import {
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  buildWorkflowBudgetInput,
  clearWorkflowBudgetDraft,
  createWorkflowBudgetDraft,
  describeLaunchParameterMapping,
  describeMappedProjectPath,
  defaultParameterDraftValue,
  readWorkflowBudgetMode,
  readMappedProjectParameterDraft,
  readLaunchDefinition,
  summarizeWorkflowBudgetDraft,
  syncRoleOverrideDrafts,
  validateLaunchDraft,
} from './playbook-launch-support.js';

describe('playbook launch support', () => {
  it('reads structured launch metadata from the playbook definition', () => {
    const summary = readLaunchDefinition({
      id: 'pb-1',
      name: 'Ship',
      slug: 'ship',
      outcome: 'Ship software',
      lifecycle: 'continuous',
      version: 1,
      definition: {
        roles: ['architect', 'developer'],
        board: {
          columns: [
            { id: 'triage', label: 'Triage' },
            { id: 'doing', label: 'Doing' },
          ],
        },
        stages: [
          { name: 'triage', goal: 'Triage new work' },
          { name: 'delivery', goal: 'Deliver the outcome' },
        ],
        parameters: [
          { name: 'ticket_id', label: 'Ticket', type: 'string', description: 'External issue key' },
          { name: 'urgency', enum: ['low', 'high'] },
          { name: 'retry_count', type: 'number', default: 2 },
        ],
      },
    });

    expect(summary.roles).toEqual(['architect', 'developer']);
    expect(summary.stageNames).toEqual(['triage', 'delivery']);
    expect(summary.boardColumns).toEqual([
      { id: 'triage', label: 'Triage' },
      { id: 'doing', label: 'Doing' },
    ]);
    expect(summary.parameterSpecs).toEqual([
      {
        key: 'ticket_id',
        label: 'Ticket',
        description: 'External issue key',
        helpText: '',
        inputType: 'string',
        defaultValue: undefined,
        options: [],
        mapsTo: undefined,
      },
      {
        key: 'urgency',
        label: 'urgency',
        description: '',
        helpText: '',
        inputType: 'select',
        defaultValue: undefined,
        options: ['low', 'high'],
        mapsTo: undefined,
      },
      {
        key: 'retry_count',
        label: 'retry_count',
        description: '',
        helpText: '',
        inputType: 'number',
        defaultValue: 2,
        options: [],
        mapsTo: undefined,
      },
    ]);
  });

  it('builds structured parameter objects from playbook-driven inputs', () => {
    const parameters = buildParametersFromDrafts(
      [
        {
          key: 'ticket_id',
          label: 'Ticket',
          description: '',
          helpText: '',
          inputType: 'string',
          options: [],
        },
        {
          key: 'retry_count',
          label: 'Retry Count',
          description: '',
          helpText: '',
          inputType: 'number',
          options: [],
        },
        {
          key: 'run_checks',
          label: 'Run Checks',
          description: '',
          helpText: '',
          inputType: 'boolean',
          options: [],
        },
        {
          key: 'mode',
          label: 'Mode',
          description: '',
          helpText: '',
          inputType: 'select',
          options: ['plan', 'ship'],
        },
        {
          key: 'context',
          label: 'Context',
          description: '',
          helpText: '',
          inputType: 'json',
          options: [],
        },
      ],
      {
        ticket_id: 'ABC-123',
        retry_count: '3',
        run_checks: 'true',
        mode: 'ship',
        context: '{"branch":"main"}',
      },
    );

    expect(parameters).toEqual({
      ticket_id: 'ABC-123',
      retry_count: 3,
      run_checks: true,
      mode: 'ship',
      context: { branch: 'main' },
    });
  });

  it('rejects duplicate structured keys and invalid role overrides', () => {
    expect(() =>
      buildStructuredObject(
        [{ id: 'a', key: 'trace_id', valueType: 'string', value: '' }],
        'Metadata',
      ),
    ).toThrow(/must include a value/i);

    expect(() =>
      buildStructuredObject(
        [
          { id: 'a', key: 'trace_id', valueType: 'string', value: 'one' },
          { id: 'b', key: 'trace_id', valueType: 'string', value: 'two' },
        ],
        'Metadata',
      ),
    ).toThrow(/duplicate key 'trace_id'/i);

    expect(() =>
      buildModelOverrides([
        { id: 'a', role: 'architect', provider: 'openai', model: '', reasoningEntries: [] },
      ]),
    ).toThrow(/must include both provider and model/i);
  });

  it('preserves playbook roles while allowing custom override rows', () => {
    const synced = syncRoleOverrideDrafts(
      ['architect', 'developer'],
      [
        { id: '1', role: 'architect', provider: 'openai', model: 'gpt-5', reasoningEntries: [] },
        {
          id: '2',
          role: 'qa',
          provider: 'anthropic',
          model: 'claude-sonnet',
          reasoningEntries: [],
        },
      ],
    );

    expect(synced.map((entry) => entry.role)).toEqual(['architect', 'developer', 'qa']);
  });

  it('serializes default draft values for structured controls', () => {
    expect(defaultParameterDraftValue(true, 'boolean')).toBe('true');
    expect(defaultParameterDraftValue({ branch: 'main' }, 'json')).toBe('{\n  "branch": "main"\n}');
    expect(defaultParameterDraftValue(undefined, 'string')).toBe('');
  });

  it('reads project-mapped launch parameter values through maps_to paths', () => {
    const repositoryDraft = readMappedProjectParameterDraft(
      {
        key: 'repository_url',
        label: 'Repository URL',
        description: '',
        helpText: '',
        inputType: 'string',
        options: [],
        mapsTo: 'project.repository_url',
      },
      {
        id: 'project-1',
        name: 'Demo',
        slug: 'demo',
        repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
        settings: { default_branch: 'main' },
      },
    );
    const branchDraft = readMappedProjectParameterDraft(
      {
        key: 'default_branch',
        label: 'Default Branch',
        description: '',
        helpText: '',
        inputType: 'string',
        options: [],
        mapsTo: 'project.settings.default_branch',
      },
      {
        id: 'project-1',
        name: 'Demo',
        slug: 'demo',
        repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
        settings: { default_branch: 'main' },
      },
    );
    const knowledgeDraft = readMappedProjectParameterDraft(
      {
        key: 'release_window',
        label: 'Release window',
        description: '',
        helpText: '',
        inputType: 'string',
        options: [],
        mapsTo: 'project.settings.knowledge.release_window',
      },
      {
        id: 'project-1',
        name: 'Demo',
        slug: 'demo',
        repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
        settings: {
          default_branch: 'main',
          knowledge: { release_window: 'Friday 16:00 Pacific' },
        },
      },
    );

    expect(repositoryDraft).toBe('https://github.com/agirunner/agirunner-test-fixtures');
    expect(branchDraft).toBe('main');
    expect(knowledgeDraft).toBe('Friday 16:00 Pacific');
  });

  it('describes project-mapped launch parameter posture for the UI', () => {
    expect(describeMappedProjectPath('project.settings.default_branch')).toBe(
      'settings → default branch',
    );
    expect(
      describeLaunchParameterMapping({
        spec: {
          key: 'repository_url',
          label: 'Repository URL',
          description: '',
          helpText: '',
          inputType: 'string',
          options: [],
          mapsTo: 'project.repository_url',
        },
        project: {
          id: 'project-1',
          name: 'Demo',
          slug: 'demo',
          repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
        },
        currentValue: 'https://github.com/agirunner/agirunner-test-fixtures',
      }),
    ).toEqual({
      badgeLabel: 'Using project value',
      detail: 'Autofilled from Demo → repository url.',
      mappedValue: 'https://github.com/agirunner/agirunner-test-fixtures',
      canRestoreMappedValue: false,
    });
    expect(
      describeLaunchParameterMapping({
        spec: {
          key: 'repository_url',
          label: 'Repository URL',
          description: '',
          helpText: '',
          inputType: 'string',
          options: [],
          mapsTo: 'project.repository_url',
        },
        project: {
          id: 'project-1',
          name: 'Demo',
          slug: 'demo',
          repository_url: 'https://github.com/agirunner/agirunner-test-fixtures',
        },
        currentValue: 'https://github.com/example/custom',
      }),
    ).toEqual({
      badgeLabel: 'Custom launch override',
      detail: 'Project value from Demo → repository url is available if you want to restore it.',
      mappedValue: 'https://github.com/agirunner/agirunner-test-fixtures',
      canRestoreMappedValue: true,
    });
  });

  it('builds structured workflow budget input from bounded launch fields', () => {
    const draft = createWorkflowBudgetDraft();
    draft.tokenBudget = '120000';
    draft.costCapUsd = '18.5';
    draft.maxDurationMinutes = '90';

    expect(buildWorkflowBudgetInput(draft)).toEqual({
      token_budget: 120000,
      cost_cap_usd: 18.5,
      max_duration_minutes: 90,
    });
  });

  it('treats workflow budget posture as an explicit open-ended or guarded state', () => {
    const draft = createWorkflowBudgetDraft();
    expect(readWorkflowBudgetMode(draft)).toBe('open-ended');

    draft.tokenBudget = '120000';
    expect(readWorkflowBudgetMode(draft)).toBe('guarded');
    expect(clearWorkflowBudgetDraft()).toEqual({
      tokenBudget: '',
      costCapUsd: '',
      maxDurationMinutes: '',
    });
  });

  it('rejects invalid workflow budget values', () => {
    expect(() =>
      buildWorkflowBudgetInput({
        tokenBudget: '1.5',
        costCapUsd: '',
        maxDurationMinutes: '',
      }),
    ).toThrow(/Token budget must be a positive whole number/i);

    expect(() =>
      buildWorkflowBudgetInput({
        tokenBudget: '',
        costCapUsd: '-3',
        maxDurationMinutes: '',
      }),
    ).toThrow(/Cost cap must be greater than zero/i);
  });

  it('describes workflow budget posture for the launch summary', () => {
    expect(
      summarizeWorkflowBudgetDraft({
        tokenBudget: '',
        costCapUsd: '12.5',
        maxDurationMinutes: '90',
      }),
    ).toBe('Workflow guardrails set for $12.5 cost cap, 90 minutes.');
  });

  it('validates launch identity and budget fields with concrete recovery guidance', () => {
    expect(
      validateLaunchDraft({
        selectedPlaybook: null,
        workflowName: '',
        workflowBudgetDraft: {
          tokenBudget: '1.5',
          costCapUsd: '-2',
          maxDurationMinutes: '0',
        },
      }),
    ).toMatchObject({
      fieldErrors: {
        playbook: 'Select a playbook before launching a run.',
        workflowName: 'Workflow name is required before launch.',
        tokenBudget: 'Token budget must be a positive whole number.',
        costCapUsd: 'Cost cap must be greater than zero.',
        maxDurationMinutes: 'Maximum duration must be a positive whole number.',
      },
      isValid: false,
    });

    expect(
      validateLaunchDraft({
        selectedPlaybook: {
          id: 'pb-1',
          name: 'Ship',
          slug: 'ship',
          outcome: 'Ship software',
          lifecycle: 'continuous',
          version: 1,
          is_active: true,
          definition: {},
        },
        workflowName: 'Ship Run',
        workflowBudgetDraft: createWorkflowBudgetDraft(),
        additionalParametersError: 'Add a key or remove this row.',
        metadataError: 'Keys must be unique within this section.',
        workflowOverrideError: 'Workflow model override roles are required.',
      }),
    ).toMatchObject({
      fieldErrors: {
        additionalParameters: 'Add a key or remove this row.',
        metadata: 'Keys must be unique within this section.',
        workflowOverrides: 'Workflow model override roles are required.',
      },
      isValid: false,
    });
  });
});
