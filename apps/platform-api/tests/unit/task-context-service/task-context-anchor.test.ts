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
          work_item_id: 'wi-1',
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
          work_item_seed_required: true,
          next_expected_actor: 'orchestrator',
          next_expected_action: 'seed the first work item and starter specialist task for the current stage',
        }),
      }),
    );
    expect(brief?.rendered_markdown).toContain(
      'No work item exists yet. Create the first work item and starter specialist task for this stage in the current activation.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Never invent work_item_id values from stage names or titles.',
    );
    expect(brief?.rendered_markdown).toContain(
      'Planning text, thoughts, verify summaries, and failed attempts do not create work items or tasks.',
    );
  });

  it('surfaces exact authored stage roles when the focused work item has no next actor yet', () => {
    const brief = buildOrchestratorExecutionBrief({
      workflow: {
        lifecycle: 'planned',
        current_stage: 'reproduce',
        active_stages: ['reproduce'],
        playbook_definition: {
          lifecycle: 'planned',
          board: {
            columns: [
              { id: 'planned', label: 'Planned' },
              { id: 'active', label: 'Active' },
              { id: 'done', label: 'Done', is_terminal: true },
            ],
          },
          stages: [
            {
              name: 'reproduce',
              goal: 'Reproduce the bug',
              involves: ['Software Developer', 'Code Reviewer'],
            },
          ],
        },
      },
      orchestratorContext: {
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'reproduce',
              column_id: 'active',
            },
          ],
          pending_dispatches: [],
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
          work_item_id: 'wi-1',
          stage_name: 'reproduce',
          exact_authored_stage_roles: ['Software Developer', 'Code Reviewer'],
        }),
      }),
    );
    expect(brief?.rendered_markdown).toContain(
      'Exact authored stage roles: Software Developer, Code Reviewer',
    );
  });

  it('tells the orchestrator to wait when an active specialist task already exists for the focused work item', () => {
    const brief = buildOrchestratorExecutionBrief({
      workflow: {
        lifecycle: 'planned',
        current_stage: 'reproduce',
        active_stages: ['reproduce'],
      },
      orchestratorContext: {
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'reproduce',
              column_id: 'active',
            },
          ],
          tasks: [
            {
              id: 'task-specialist-1',
              title: 'Reproduce audit export hang',
              role: 'Software Developer',
              state: 'in_progress',
              work_item_id: 'wi-1',
              stage_name: 'reproduce',
              is_orchestrator_task: false,
            },
          ],
          pending_dispatches: [],
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
          work_item_id: 'wi-1',
          stage_name: 'reproduce',
          active_subordinate_task_id: 'task-specialist-1',
          active_subordinate_task_role: 'Software Developer',
          next_expected_actor: 'Software Developer',
          next_expected_action: 'wait for the active specialist task to complete before routing more work',
        }),
      }),
    );
    expect(brief?.rendered_markdown).toContain(
      'Active specialist task id: task-specialist-1',
    );
    expect(brief?.rendered_markdown).toContain(
      'Do not create another task for this work item in the current activation.',
    );
  });
});
