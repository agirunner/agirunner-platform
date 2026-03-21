import { describe, expect, it } from 'vitest';

import { parsePlaybookDefinition } from '../../src/orchestration/playbook-model.js';
import { evaluatePlaybookRules } from '../../src/services/playbook-rule-evaluation-service.js';

const sdlcDefinition = parsePlaybookDefinition({
  process_instructions:
    'Product clarifies the work, architecture designs it, implementation is reviewed, verification follows review, and release requires human approval.',
  roles: ['product-manager', 'architect', 'developer', 'reviewer', 'qa'],
  lifecycle: 'planned',
  board: {
    entry_column_id: 'planned',
    columns: [{ id: 'planned', label: 'Planned' }],
  },
  checkpoints: [
    { name: 'requirements', goal: 'Requirements are approved.', human_gate: true },
    { name: 'design', goal: 'Design is complete.' },
    { name: 'implementation', goal: 'Implementation is complete.' },
    { name: 'review', goal: 'Review is complete.' },
    { name: 'verification', goal: 'Verification is complete.' },
    { name: 'release', goal: 'Release is approved.', human_gate: true },
  ],
  review_rules: [
    {
      from_role: 'developer',
      reviewed_by: 'reviewer',
      checkpoint: 'implementation',
      required: true,
      on_reject: {
        action: 'return_to_role',
        role: 'developer',
      },
    },
  ],
  approval_rules: [
    { on: 'checkpoint', checkpoint: 'requirements', approved_by: 'human', required: true },
    { on: 'checkpoint', checkpoint: 'release', approved_by: 'human', required: true },
  ],
  handoff_rules: [
    { from_role: 'product-manager', to_role: 'architect', checkpoint: 'requirements', required: true },
    { from_role: 'architect', to_role: 'developer', checkpoint: 'design', required: true },
    { from_role: 'developer', to_role: 'reviewer', checkpoint: 'implementation', required: true },
    { from_role: 'reviewer', to_role: 'qa', checkpoint: 'review', required: true },
    { from_role: 'qa', to_role: 'product-manager', checkpoint: 'verification', required: true },
  ],
});

describe('evaluatePlaybookRules', () => {
  const definition = parsePlaybookDefinition({
    process_instructions:
      'Developer implements. Reviewer reviews every code change. QA validates. Human approves requirements and verification.',
    roles: ['product-manager', 'developer', 'reviewer', 'qa'],
    board: {
      entry_column_id: 'planned',
      columns: [{ id: 'planned', label: 'Planned' }],
    },
    checkpoints: [
      { name: 'requirements', goal: 'Requirements are approved.', human_gate: true },
      { name: 'verification', goal: 'Verification is complete.', human_gate: true },
    ],
    review_rules: [
      {
        from_role: 'developer',
        reviewed_by: 'reviewer',
        checkpoint: 'implementation',
        required: true,
        on_reject: {
          action: 'return_to_role',
          role: 'developer',
        },
      },
    ],
    approval_rules: [
      {
        on: 'checkpoint',
        checkpoint: 'requirements',
        approved_by: 'human',
        required: true,
      },
      {
        on: 'completion',
        approved_by: 'human',
        required: true,
      },
    ],
    handoff_rules: [
      {
        from_role: 'reviewer',
        to_role: 'qa',
        checkpoint: 'verification',
        required: true,
      },
    ],
  });

  it('requires mandatory review after a developer completion', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'task_completed',
      role: 'developer',
      checkpointName: 'implementation',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'review',
      nextExpectedActor: 'reviewer',
      nextExpectedAction: 'review',
      requiresHumanApproval: false,
    });
  });

  it('routes review rejection back to the configured role', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'review_rejected',
      role: 'developer',
      checkpointName: 'implementation',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'review',
      nextExpectedActor: 'developer',
      nextExpectedAction: 'rework',
      reworkDelta: 1,
    });
  });

  it('requires human approval for configured checkpoints', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'checkpoint_reached',
      role: 'product-manager',
      checkpointName: 'requirements',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'approval',
      nextExpectedActor: 'human',
      nextExpectedAction: 'approve',
      requiresHumanApproval: true,
    });
  });

  it('does not derive same-stage handoff continuity for planned workflows', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'task_completed',
      role: 'reviewer',
      checkpointName: 'verification',
    });

    expect(result).toMatchObject({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
    });
  });

  it('preserves same-stage handoff continuity for ongoing workflows', () => {
    const ongoing = parsePlaybookDefinition({
      process_instructions: 'Reviewer hands work to QA inside the same ongoing work item.',
      roles: ['reviewer', 'qa'],
      board: {
        entry_column_id: 'planned',
        columns: [{ id: 'planned', label: 'Planned' }],
      },
      checkpoints: [{ name: 'verification', goal: 'Verification is completed.' }],
      handoff_rules: [
        {
          from_role: 'reviewer',
          to_role: 'qa',
          checkpoint: 'verification',
          required: true,
        },
      ],
      lifecycle: 'ongoing',
    });

    const result = evaluatePlaybookRules({
      definition: ongoing,
      event: 'task_completed',
      role: 'reviewer',
      checkpointName: 'verification',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'handoff',
      nextExpectedActor: 'qa',
      nextExpectedAction: 'handoff',
    });
  });

  it('matches scoped rules only at the configured checkpoint', () => {
    const requirementOnly = parsePlaybookDefinition({
      process_instructions: 'Requirements route from product manager to architect; release does not.',
      roles: ['product-manager', 'architect'],
      lifecycle: 'ongoing',
      board: {
        entry_column_id: 'planned',
        columns: [{ id: 'planned', label: 'Planned' }],
      },
      checkpoints: [
        { name: 'requirements', goal: 'Requirements are approved.' },
        { name: 'release', goal: 'Release is approved.' },
      ],
      handoff_rules: [
        {
          from_role: 'product-manager',
          to_role: 'architect',
          checkpoint: 'requirements',
          required: true,
        },
      ],
    });

    expect(
      evaluatePlaybookRules({
        definition: requirementOnly,
        event: 'task_completed',
        role: 'product-manager',
        checkpointName: 'requirements',
      }),
    ).toMatchObject({
      matchedRuleType: 'handoff',
      nextExpectedActor: 'architect',
      nextExpectedAction: 'handoff',
    });

    expect(
      evaluatePlaybookRules({
        definition: requirementOnly,
        event: 'task_completed',
        role: 'product-manager',
        checkpointName: 'release',
      }),
    ).toMatchObject({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
    });
  });

  it('returns no forced action when no matching rule exists', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'task_completed',
      role: 'qa',
      checkpointName: 'verification',
    });

    expect(result).toMatchObject({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      requiresHumanApproval: false,
      reworkDelta: 0,
    });
  });

  it('does not expose reviewer to qa handoff continuity in a planned sdlc-style playbook', () => {
    const result = evaluatePlaybookRules({
      definition: sdlcDefinition,
      event: 'task_completed',
      role: 'reviewer',
      checkpointName: 'review',
    });

    expect(result).toMatchObject({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
    });
  });

  it('supports an sdlc-style rule chain from requirements through release', () => {
    const definition = sdlcDefinition;

    const checkpoints = [
      evaluatePlaybookRules({
        definition,
        event: 'task_completed',
        role: 'product-manager',
        checkpointName: 'requirements',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'checkpoint_reached',
        role: 'product-manager',
        checkpointName: 'requirements',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'task_completed',
        role: 'architect',
        checkpointName: 'design',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'task_completed',
        role: 'developer',
        checkpointName: 'implementation',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'review_rejected',
        role: 'developer',
        checkpointName: 'implementation',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'task_completed',
        role: 'reviewer',
        checkpointName: 'review',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'task_completed',
        role: 'qa',
        checkpointName: 'verification',
      }),
      evaluatePlaybookRules({
        definition,
        event: 'checkpoint_reached',
        role: 'product-manager',
        checkpointName: 'release',
      }),
    ];

    expect(checkpoints).toEqual([
      expect.objectContaining({
        matchedRuleType: null,
        nextExpectedActor: null,
        nextExpectedAction: null,
      }),
      expect.objectContaining({
        matchedRuleType: 'approval',
        nextExpectedActor: 'human',
        nextExpectedAction: 'approve',
      }),
      expect.objectContaining({
        matchedRuleType: null,
        nextExpectedActor: null,
        nextExpectedAction: null,
      }),
      expect.objectContaining({
        matchedRuleType: 'review',
        nextExpectedActor: 'reviewer',
        nextExpectedAction: 'review',
      }),
      expect.objectContaining({
        matchedRuleType: 'review',
        nextExpectedActor: 'developer',
        nextExpectedAction: 'rework',
        reworkDelta: 1,
      }),
      expect.objectContaining({
        matchedRuleType: null,
        nextExpectedActor: null,
        nextExpectedAction: null,
      }),
      expect.objectContaining({
        matchedRuleType: null,
        nextExpectedActor: null,
        nextExpectedAction: null,
      }),
      expect.objectContaining({
        matchedRuleType: 'approval',
        nextExpectedActor: 'human',
        nextExpectedAction: 'approve',
      }),
    ]);
  });
});
