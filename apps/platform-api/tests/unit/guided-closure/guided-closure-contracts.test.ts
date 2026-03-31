import { describe, expect, it } from 'vitest';

import { taskHandoffs } from '../../../src/db/schema/task-handoffs.js';
import { workflowStageGates } from '../../../src/db/schema/workflow-stage-gates.js';
import { workflowSubjectEscalations } from '../../../src/db/schema/workflow-subject-escalations.js';
import { workflowToolResults } from '../../../src/db/schema/workflow-tool-results.js';
import { workflowActivations } from '../../../src/db/schema/workflow-activations.js';
import { workflows } from '../../../src/db/schema/workflows.js';
import { workflowWorkItems } from '../../../src/db/schema/workflow-work-items.js';
import {
  completionCalloutsSchema,
  guidedClosureMutationResponseSchema,
} from '../../../src/services/guided-closure/types.js';

describe('guided closure contracts', () => {
  it('adds structured completion callouts to workflows and work items', () => {
    expect(workflows.completionCallouts).toBeDefined();
    expect(workflowWorkItems.completionCallouts).toBeDefined();
  });

  it('adds invoked control closure metadata to gates and escalations', () => {
    expect(workflowStageGates.closureEffect).toBeDefined();
    expect(workflowStageGates.requestedByTaskId).toBeDefined();
    expect(workflowStageGates.resolvedByTaskId).toBeDefined();
    expect(workflowSubjectEscalations.closureEffect).toBeDefined();
    expect(workflowSubjectEscalations.resolutionStatus).toBeDefined();
    expect(workflowSubjectEscalations.resolvedByTaskId).toBeDefined();
  });

  it('adds guided closure fields to handoffs, tool results, and activations', () => {
    expect(taskHandoffs.recommendedNextActions).toBeDefined();
    expect(taskHandoffs.completionCallouts).toBeDefined();
    expect(workflowToolResults.mutationOutcome).toBeDefined();
    expect(workflowToolResults.recoveryClass).toBeDefined();
    expect(workflowActivations.closureContext).toBeDefined();
  });

  it('parses structured completion callouts', () => {
    const parsed = completionCalloutsSchema.parse({
      residual_risks: [
        {
          code: 'brand_review_skipped',
          summary: 'No brand reviewer contributed before closure.',
          evidence_refs: ['handoff:1'],
        },
      ],
      unmet_preferred_expectations: [
        {
          code: 'preferred_same_stage_review_missing',
          summary: 'Preferred second reviewer was waived.',
        },
      ],
      waived_steps: [
        {
          code: 'waived_role_contribution',
          reason: 'Existing review already produced a decisive outcome.',
        },
      ],
      unresolved_advisory_items: [
        {
          kind: 'escalation',
          id: 'esc-1',
          summary: 'Operator escalation remained advisory.',
        },
      ],
      completion_notes: 'Workflow completed with recorded advisory concerns.',
    });

    expect(parsed.completion_notes).toBe('Workflow completed with recorded advisory concerns.');
  });

  it('parses typed recoverable mutation responses', () => {
    const parsed = guidedClosureMutationResponseSchema.parse({
      mutation_outcome: 'recoverable_not_applied',
      recovery_class: 'approval_not_configured',
      blocking: false,
      reason_code: 'approval_not_configured',
      state_snapshot: {
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
        current_stage: 'review',
        active_blocking_controls: [],
        active_advisory_controls: [
          {
            kind: 'approval',
            id: 'gate-1',
            closure_effect: 'advisory',
          },
        ],
      },
      suggested_next_actions: [
        {
          action_code: 'continue_work',
          target_type: 'work_item',
          target_id: 'work-item-1',
          why: 'Approval was advisory only.',
          requires_orchestrator_judgment: false,
        },
      ],
      suggested_target_ids: {
        workflow_id: 'workflow-1',
        work_item_id: 'work-item-1',
        task_id: 'task-1',
      },
      callout_recommendations: [
        {
          code: 'approval_not_configured',
          summary: 'No human gate is configured for this stage.',
        },
      ],
      closure_still_possible: true,
    });

    expect(parsed.mutation_outcome).toBe('recoverable_not_applied');
    if (parsed.mutation_outcome !== 'recoverable_not_applied') {
      throw new Error('expected recoverable guided-closure mutation response');
    }
    expect(parsed.state_snapshot.current_stage).toBe('review');
  });
});
