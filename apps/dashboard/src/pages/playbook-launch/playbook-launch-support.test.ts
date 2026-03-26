import { describe, expect, it } from 'vitest';

import {
  buildModelOverrides,
  buildParametersFromDrafts,
  buildStructuredObject,
  buildWorkflowBudgetInput,
  clearWorkflowBudgetDraft,
  createWorkflowBudgetDraft,
  readLaunchDefinition,
  readWorkflowBudgetMode,
  summarizeWorkflowBudgetDraft,
  validateLaunchDraft,
} from './playbook-launch-support.js';

describe('playbook launch support', () => {
  it('reads only the declared launch input contract from the playbook definition', () => {
    const summary = readLaunchDefinition({
      id: 'pb-1',
      name: 'Ship',
      slug: 'ship',
      outcome: 'Ship software',
      lifecycle: 'ongoing',
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
          { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
          { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
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
      { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
      { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
    ]);
  });

  it('builds workflow parameters from declared launch inputs only', () => {
    const parameters = buildParametersFromDrafts(
      [
        { slug: 'workflow_goal', title: 'Workflow Goal', required: true },
        { slug: 'acceptance_notes', title: 'Acceptance Notes', required: false },
      ],
      {
        workflow_goal: 'Ship the release candidate',
        acceptance_notes: '',
      },
    );

    expect(parameters).toEqual({
      workflow_goal: 'Ship the release candidate',
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

  it('validates launch identity, required launch inputs, and budget fields', () => {
    expect(
      validateLaunchDraft({
        selectedPlaybook: null,
        workflowName: '',
        workflowBudgetDraft: {
          tokenBudget: '1.5',
          costCapUsd: '-2',
          maxDurationMinutes: '0',
        },
        parameterSpecs: [],
        parameterDrafts: {},
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
          lifecycle: 'ongoing',
          version: 1,
          is_active: true,
          definition: {},
        },
        workflowName: 'Ship Run',
        workflowBudgetDraft: createWorkflowBudgetDraft(),
        parameterSpecs: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
        parameterDrafts: { workflow_goal: '' },
        metadataError: 'Keys must be unique within this section.',
        workflowOverrideError: 'Workflow model override roles are required.',
      }),
    ).toMatchObject({
      fieldErrors: {
        parameters: "Enter a value for required launch input 'Workflow Goal'.",
        metadata: 'Keys must be unique within this section.',
        workflowOverrides: 'Workflow model override roles are required.',
      },
      isValid: false,
    });
  });
});
