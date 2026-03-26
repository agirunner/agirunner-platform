import { describe, expect, it } from 'vitest';

import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  hydratePlaybookAuthoringDraft,
  reconcileValidationIssues,
  summarizePlaybookAuthoringDraft,
  validateBoardColumnsDraft,
  validateParameterDrafts,
  validateRoleDrafts,
  validateWorkflowRulesDraft,
} from './playbook-authoring-support.js';

describe('playbook authoring support', () => {
  it('starts new drafts with stages instead of governance rules', () => {
    const draft = createDefaultAuthoringDraft('planned');

    expect(draft.roles).toEqual([]);
    expect(draft.stages).toEqual([]);
    expect(draft.columns).toHaveLength(5);
    expect(draft.process_instructions).toContain('mandatory');
    expect(draft.process_instructions).toContain('preferred');
    expect(draft.process_instructions).toContain('residual risks');
    expect(draft.process_instructions).toContain('close the workflow');
    expect(draft.orchestrator.max_rework_iterations).toBe('');
    expect(draft.orchestrator.max_active_tasks).toBe('');
    expect(draft.orchestrator.max_active_tasks_per_work_item).toBe('');
    expect(draft.orchestrator.allow_parallel_work_items).toBe('');
  });

  it('builds a prose-governed playbook definition', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.roles = [{ value: 'architect' }, { value: 'developer' }, { value: 'reviewer' }];
    draft.process_instructions =
      'The architect clarifies scope, the developer implements, the reviewer performs a substantive release review, and the orchestrator pauses for human approval before publishing.';
    draft.stages = [
      { name: 'plan', goal: 'Clarify the objective and execution path.', guidance: '' },
      {
        name: 'deliver',
        goal: 'Produce and package the requested change.',
        guidance: 'Seek review and approval when the release packet is ready.',
      },
    ];
    draft.parameters = [
      {
        slug: 'workflow_goal',
        title: 'Workflow Goal',
        required: true,
      },
    ];

    const built = buildPlaybookDefinition('planned', draft);

    expect(built).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          lifecycle: 'planned',
          roles: ['architect', 'developer', 'reviewer'],
          process_instructions: draft.process_instructions,
          parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
          stages: expect.arrayContaining([
            expect.objectContaining({ name: 'plan', goal: 'Clarify the objective and execution path.' }),
            expect.objectContaining({
              name: 'deliver',
              guidance: 'Seek review and approval when the release packet is ready.',
            }),
          ]),
        }),
      }),
    );
    if (built.ok) {
      expect(built.value).not.toHaveProperty('checkpoints');
      expect(built.value).not.toHaveProperty('assessment_rules');
      expect(built.value).not.toHaveProperty('approval_rules');
      expect(built.value).not.toHaveProperty('handoff_rules');
      expect(built.value).not.toHaveProperty('branch_policies');
    }
  });

  it('hydrates authoring drafts from stages and process instructions', () => {
    const draft = hydratePlaybookAuthoringDraft('planned', {
      process_instructions: 'Use the stages as milestones and request human approval before release.',
      roles: ['architect', 'developer'],
      stages: [{ name: 'design', goal: 'Plan the solution.', guidance: 'Capture decisions.' }],
      board: {
        entry_column_id: 'active',
        columns: [{ id: 'active', label: 'Active' }],
      },
      orchestrator: { max_active_tasks: 6 },
      parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
    });

    expect(draft.process_instructions).toContain('request human approval');
    expect(draft.stages).toEqual([
      { name: 'design', goal: 'Plan the solution.', guidance: 'Capture decisions.' },
    ]);
    expect(draft.entry_column_id).toBe('active');
    expect(draft.orchestrator.max_active_tasks).toBe('6');
    expect(draft.parameters[0]).toEqual({
      slug: 'workflow_goal',
      title: 'Workflow Goal',
      required: true,
    });
  });

  it('omits orchestration-policy overrides unless the user sets them', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.roles = [{ value: 'architect' }];
    draft.stages = [{ name: 'deliver', goal: 'Ship the requested change.', guidance: '' }];

    const built = buildPlaybookDefinition('planned', draft);

    expect(built).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.not.objectContaining({
          orchestrator: expect.anything(),
        }),
      }),
    );
  });

  it('validates stages and minimal launch inputs', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.stages = [{ name: '', goal: '', guidance: '' }];
    draft.parameters = [
      {
        slug: '',
        title: '',
        required: false,
      },
      {
        slug: 'workflow_goal',
        title: 'Workflow Goal',
        required: true,
      },
      {
        slug: 'workflow_goal',
        title: 'Workflow Goal Copy',
        required: false,
      },
    ];

    const stageValidation = validateWorkflowRulesDraft(draft);
    const parameterValidation = validateParameterDrafts(draft.parameters);

    expect(stageValidation.isValid).toBe(false);
    expect(stageValidation.blockingIssues).toContain('Every stage needs a name.');
    expect(stageValidation.blockingIssues).toContain('Every stage needs a goal.');
    expect(parameterValidation.isValid).toBe(false);
    expect(parameterValidation.blockingIssues).toContain('Every launch input needs a slug.');
    expect(parameterValidation.blockingIssues).toContain('Every launch input needs a title.');
    expect(parameterValidation.blockingIssues).toContain('Launch input slugs must be unique.');
  });

  it('summarizes stages instead of governance-rule counts', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.roles = [{ value: 'architect' }];
    draft.stages = [{ name: 'deliver', goal: 'Ship the requested change.', guidance: '' }];

    expect(summarizePlaybookAuthoringDraft(draft)).toEqual(
      expect.objectContaining({
        hasProcessInstructions: true,
        roleCount: 1,
        stageCount: 1,
        columnCount: 5,
      }),
    );
  });

  it('preserves must-versus-preferred prose when building the definition', () => {
    const draft = createDefaultAuthoringDraft('planned');
    draft.roles = [{ value: 'architect' }];
    draft.process_instructions =
      'Mandatory: produce a publishable release packet and close the workflow with residual risks recorded when needed. Preferred: get peer review and human approval before release, but if those are unavailable the orchestrator must still drive to a close-enough outcome and record callouts.';
    draft.stages = [{ name: 'deliver', goal: 'Ship the requested change.', guidance: '' }];

    const built = buildPlaybookDefinition('planned', draft);

    expect(built).toEqual(
      expect.objectContaining({
        ok: true,
        value: expect.objectContaining({
          process_instructions: expect.stringContaining('Mandatory: produce a publishable release packet'),
        }),
      }),
    );
    if (built.ok) {
      expect(String(built.value.process_instructions)).toContain('Preferred: get peer review');
      expect(String(built.value.process_instructions)).toContain('record callouts');
    }
  });

  it('validates role membership and board entry columns', () => {
    expect(validateRoleDrafts([{ value: 'architect' }], ['architect']).isValid).toBe(true);
    expect(validateRoleDrafts([], ['architect']).isValid).toBe(false);
    expect(validateRoleDrafts([{ value: '  ' }], ['architect']).isValid).toBe(false);
    expect(
      validateBoardColumnsDraft(
        [{ id: 'active', label: 'Active', description: '', is_blocked: false, is_terminal: false }],
        'missing',
      ).isValid,
    ).toBe(false);
  });

  it('requires exactly one blocked lane and one terminal lane', () => {
    expect(
      validateBoardColumnsDraft([
        { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
        { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
      ], 'inbox'),
    ).toEqual(
      expect.objectContaining({
        isValid: false,
        blockingIssues: expect.arrayContaining(['Choose exactly one blocked lane.']),
      }),
    );

    expect(
      validateBoardColumnsDraft([
        { id: 'inbox', label: 'Inbox', description: '', is_blocked: true, is_terminal: false },
        { id: 'blocked', label: 'Blocked', description: '', is_blocked: true, is_terminal: false },
        { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
      ], 'inbox'),
    ).toEqual(
      expect.objectContaining({
        isValid: false,
        blockingIssues: expect.arrayContaining(['Choose exactly one blocked lane.']),
      }),
    );

    expect(
      validateBoardColumnsDraft([
        { id: 'inbox', label: 'Inbox', description: '', is_blocked: true, is_terminal: false },
        { id: 'active', label: 'Active', description: '', is_blocked: false, is_terminal: false },
      ], 'active'),
    ).toEqual(
      expect.objectContaining({
        isValid: false,
        blockingIssues: expect.arrayContaining(['Choose exactly one terminal lane.']),
      }),
    );
  });

  it('rejects intake lanes that point at blocked or terminal columns', () => {
    expect(
      validateBoardColumnsDraft([
        { id: 'inbox', label: 'Inbox', description: '', is_blocked: true, is_terminal: false },
        { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
      ], 'inbox'),
    ).toEqual(
      expect.objectContaining({
        isValid: false,
        blockingIssues: expect.arrayContaining(['Choose an intake lane that is not blocked or terminal.']),
      }),
    );

    expect(
      validateBoardColumnsDraft([
        { id: 'inbox', label: 'Inbox', description: '', is_blocked: false, is_terminal: false },
        { id: 'done', label: 'Done', description: '', is_blocked: false, is_terminal: true },
      ], 'done'),
    ).toEqual(
      expect.objectContaining({
        isValid: false,
        blockingIssues: expect.arrayContaining(['Choose an intake lane that is not blocked or terminal.']),
      }),
    );
  });

  it('reuses the current validation-issue array when the contents are unchanged', () => {
    const currentIssues = ['Every stage needs a name.', 'Every stage needs a goal.'];
    const nextIssues = ['Every stage needs a name.', 'Every stage needs a goal.'];

    expect(reconcileValidationIssues(currentIssues, nextIssues)).toBe(currentIssues);
  });

  it('replaces the validation-issue array when the contents change', () => {
    const currentIssues = ['Every stage needs a name.'];
    const nextIssues = ['Every stage needs a goal.'];

    expect(reconcileValidationIssues(currentIssues, nextIssues)).toBe(nextIssues);
  });

  it('blocks playbook definitions that do not select any specialists', () => {
    const built = buildPlaybookDefinition('planned', {
      ...createDefaultAuthoringDraft('planned'),
      process_instructions: 'Mandatory outcomes: complete the work and record residual risk.',
    });

    expect(built).toEqual({
      ok: false,
      error: 'Select at least one specialist for this workflow.',
    });
  });
});
