import { describe, expect, it } from 'vitest';

import { parsePlaybookDefinition } from '../../src/orchestration/playbook-model.js';
import { evaluatePlaybookRules } from '../../src/services/playbook-rule-evaluation-service.js';

describe('evaluatePlaybookRules', () => {
  const definition = parsePlaybookDefinition({
    process_instructions:
      'Move work through requirements, implementation, review, verification, and release using explicit handoffs, assessments, approvals, and escalations only when the process calls for them.',
    roles: ['product-manager', 'developer', 'reviewer', 'qa'],
    lifecycle: 'planned',
    board: {
      entry_column_id: 'planned',
      columns: [{ id: 'planned', label: 'Planned' }],
    },
    stages: [
      { name: 'requirements', goal: 'Clarify the requested work.' },
      { name: 'implementation', goal: 'Build the requested change.' },
      { name: 'review', goal: 'Review the produced work.' },
      { name: 'verification', goal: 'Verify the final output.' },
      { name: 'release', goal: 'Ship the accepted outcome.' },
    ],
  });

  it('does not derive forced assessment routing from playbook config that no longer exists', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'task_completed',
      role: 'developer',
      checkpointName: 'implementation',
    });

    expect(result).toEqual({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      requiresHumanApproval: false,
      reworkDelta: 0,
    });
  });

  it('does not derive forced approval routing from playbook config that no longer exists', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'checkpoint_reached',
      role: 'product-manager',
      checkpointName: 'requirements',
    });

    expect(result).toEqual({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      requiresHumanApproval: false,
      reworkDelta: 0,
    });
  });

  it('does not derive request-changes routing from deleted governance metadata', () => {
    const result = evaluatePlaybookRules({
      definition,
      event: 'assessment_requested_changes',
      role: 'developer',
      checkpointName: 'implementation',
      decisionState: 'request_changes',
    });

    expect(result).toEqual({
      matchedRuleType: null,
      nextExpectedActor: null,
      nextExpectedAction: null,
      requiresHumanApproval: false,
      reworkDelta: 0,
    });
  });
});
