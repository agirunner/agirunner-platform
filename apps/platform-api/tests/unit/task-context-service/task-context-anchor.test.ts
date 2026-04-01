import { describe, expect, it } from 'vitest';

import { buildOrchestratorExecutionBrief } from '../../../src/services/task-context-service/task-context-anchor.js';

describe('buildOrchestratorExecutionBrief', () => {
  it('surfaces pending dispatches as compact current focus', () => {
    const brief = buildOrchestratorExecutionBrief({
      workflow: {
        lifecycle: 'planned',
        current_stage: 'reproduce',
        active_stages: ['reproduce'],
      },
      orchestratorContext: {
        board: {
          pending_dispatches: [
            {
              work_item_id: 'wi-1',
              stage_name: 'reproduce',
              actor: 'Software Developer',
              action: 'investigate',
              title: 'Reproduce export timeout',
            },
          ],
        },
      },
      workflowLiveVisibility: {
        mode: 'enhanced',
        execution_context_id: 'activation-1',
      },
    });

    expect(brief).toEqual(
      expect.objectContaining({
        current_focus: expect.objectContaining({
          lifecycle: 'planned',
          stage_name: 'reproduce',
          next_expected_actor: 'Software Developer',
          next_expected_action: 'investigate',
        }),
        operator_visibility: expect.objectContaining({
          execution_context_id: 'activation-1',
        }),
      }),
    );
  });

  it('tells the orchestrator to seed the first stage when no work item exists yet', () => {
    const brief = buildOrchestratorExecutionBrief({
      workflow: {
        lifecycle: 'planned',
        current_stage: 'reproduce',
        active_stages: ['reproduce'],
      },
      orchestratorContext: {
        board: {
          work_items: [],
          pending_dispatches: [],
        },
      },
      workflowLiveVisibility: {
        mode: 'enhanced',
      },
    });

    expect(brief).toEqual(
      expect.objectContaining({
        current_focus: expect.objectContaining({
          lifecycle: 'planned',
          stage_name: 'reproduce',
          next_expected_actor: 'orchestrator',
          next_expected_action: 'seed the first work item and starter specialist task for the current stage',
        }),
      }),
    );
  });
});
