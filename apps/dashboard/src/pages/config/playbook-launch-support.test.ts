import { describe, expect, it } from 'vitest';

import {
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  buildWorkflowBudgetInput,
  createWorkflowBudgetDraft,
  defaultParameterDraftValue,
  readMappedProjectParameterDraft,
  readLaunchDefinition,
  syncRoleOverrideDrafts,
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
        inputType: 'string',
        defaultValue: undefined,
        options: [],
        mapsTo: undefined,
      },
      {
        key: 'urgency',
        label: 'urgency',
        description: '',
        inputType: 'select',
        defaultValue: undefined,
        options: ['low', 'high'],
        mapsTo: undefined,
      },
      {
        key: 'retry_count',
        label: 'retry_count',
        description: '',
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
        { key: 'ticket_id', label: 'Ticket', description: '', inputType: 'string', options: [] },
        { key: 'retry_count', label: 'Retry Count', description: '', inputType: 'number', options: [] },
        { key: 'run_checks', label: 'Run Checks', description: '', inputType: 'boolean', options: [] },
        { key: 'mode', label: 'Mode', description: '', inputType: 'select', options: ['plan', 'ship'] },
        { key: 'context', label: 'Context', description: '', inputType: 'json', options: [] },
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
        { id: '2', role: 'qa', provider: 'anthropic', model: 'claude-sonnet', reasoningEntries: [] },
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
        inputType: 'string',
        options: [],
        mapsTo: 'project.repository_url',
      },
      {
        id: 'project-1',
        name: 'Demo',
        slug: 'demo',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures',
        settings: { default_branch: 'main' },
      },
    );
    const branchDraft = readMappedProjectParameterDraft(
      {
        key: 'default_branch',
        label: 'Default Branch',
        description: '',
        inputType: 'string',
        options: [],
        mapsTo: 'project.settings.default_branch',
      },
      {
        id: 'project-1',
        name: 'Demo',
        slug: 'demo',
        repository_url: 'https://github.com/agisnap/agirunner-test-fixtures',
        settings: { default_branch: 'main' },
      },
    );

    expect(repositoryDraft).toBe('https://github.com/agisnap/agirunner-test-fixtures');
    expect(branchDraft).toBe('main');
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
});
