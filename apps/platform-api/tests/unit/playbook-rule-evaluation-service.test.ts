import { describe, expect, it } from 'vitest';

import { BUILT_IN_PLAYBOOKS } from '../../src/catalogs/built-in-playbooks.js';
import { parsePlaybookDefinition } from '../../src/orchestration/playbook-model.js';
import { evaluatePlaybookRules } from '../../src/services/playbook-rule-evaluation-service.js';

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

  it('falls through to a required handoff when no review rule applies', () => {
    const result = evaluatePlaybookRules({
      definition,
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

  it('enforces the mandatory reviewer to qa handoff in the built-in sdlc playbook', () => {
    const sdlc = BUILT_IN_PLAYBOOKS.find((playbook) => playbook.slug === 'sdlc-v2');
    expect(sdlc).toBeDefined();

    const result = evaluatePlaybookRules({
      definition: parsePlaybookDefinition(sdlc!.definition),
      event: 'task_completed',
      role: 'reviewer',
      checkpointName: 'review',
    });

    expect(result).toMatchObject({
      matchedRuleType: 'handoff',
      nextExpectedActor: 'qa',
      nextExpectedAction: 'handoff',
    });
  });

  it('supports the seeded sdlc hello world rule chain from requirements through release', () => {
    const sdlc = BUILT_IN_PLAYBOOKS.find((playbook) => playbook.slug === 'sdlc-v2');
    expect(sdlc).toBeDefined();
    const definition = parsePlaybookDefinition(sdlc!.definition);

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
        matchedRuleType: 'handoff',
        nextExpectedActor: 'architect',
        nextExpectedAction: 'handoff',
      }),
      expect.objectContaining({
        matchedRuleType: 'approval',
        nextExpectedActor: 'human',
        nextExpectedAction: 'approve',
      }),
      expect.objectContaining({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'developer',
        nextExpectedAction: 'handoff',
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
        matchedRuleType: 'handoff',
        nextExpectedActor: 'qa',
        nextExpectedAction: 'handoff',
      }),
      expect.objectContaining({
        matchedRuleType: 'handoff',
        nextExpectedActor: 'product-manager',
        nextExpectedAction: 'handoff',
      }),
      expect.objectContaining({
        matchedRuleType: 'approval',
        nextExpectedActor: 'human',
        nextExpectedAction: 'approve',
      }),
    ]);
  });
});
