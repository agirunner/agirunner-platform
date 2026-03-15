import { describe, expect, it } from 'vitest';

import { buildWorkflowInstructionLayer } from '../../src/services/workflow-instruction-layer.js';

describe('buildWorkflowInstructionLayer', () => {
  it('builds planned orchestrator guidance with checkpoint, continuity, and repo protocol', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['review'],
        variables: { repository_url: 'https://github.com/example/repo' },
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Developer implements, reviewer reviews, and a human approves before completion.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'review', label: 'In Review' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'implementation', goal: 'Build the change' },
              { name: 'review', goal: 'Ensure reviewer sign-off', human_gate: true },
            ],
            approval_rules: [
              { on: 'checkpoint', checkpoint: 'review', approved_by: 'human', required: true },
            ],
            orchestrator: {
              max_active_tasks: 4,
              max_active_tasks_per_work_item: 2,
              allow_parallel_work_items: true,
            },
          },
        },
      },
      orchestratorContext: {
        activation: { payload: { work_item_id: 'wi-1' } },
        board: {
          work_items: [
            {
              id: 'wi-1',
              current_checkpoint: 'review',
              column_id: 'review',
              next_expected_actor: 'human',
              next_expected_action: 'approve',
              rework_count: 1,
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Workflow Mode: planned');
    expect(layer!.content).toContain('## Process Instructions');
    expect(layer!.content).toContain('## Progress Model\nCheckpoint-driven');
    expect(layer!.content).toContain('## Current Checkpoint\nreview');
    expect(layer!.content).toContain('Human gate: yes');
    expect(layer!.content).toContain('## Rule Results');
    expect(layer!.content).toContain('Next expected actor: human');
    expect(layer!.content).toContain('Next expected action: approve');
    expect(layer!.content).toContain('Human approval required before completion.');
    expect(layer!.content).toContain('## Parallelism');
    expect(layer!.content).toContain('Max active tasks: 4');
    expect(layer!.content).toContain('Repository-backed workflow. Inspect files, diffs, and git state before deciding.');
  });

  it('builds ongoing specialist guidance with board-driven progression and predecessor context', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: false,
      role: 'developer',
      workflow: {
        lifecycle: 'ongoing',
        playbook: {
          definition: {
            lifecycle: 'ongoing',
            process_instructions: 'Keep intake moving and route developer output through reviewer before completion.',
            board: {
              columns: [
                { id: 'inbox', label: 'Inbox' },
                { id: 'review', label: 'In Review' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [],
            review_rules: [
              { from_role: 'developer', reviewed_by: 'reviewer', required: true },
            ],
          },
        },
      },
      workItem: {
        column_id: 'review',
        owner_role: 'developer',
        next_expected_actor: 'reviewer',
        next_expected_action: 'review',
      },
      predecessorHandoff: {
        role: 'architect',
        summary: 'The design is ready for implementation.',
        successor_context: 'Preserve the interface contract.',
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Workflow Mode: ongoing');
    expect(layer!.content).toContain('## Process Instructions');
    expect(layer!.content).toContain('## Progress Model\nBoard-driven');
    expect(layer!.content).toContain('Use board lane posture and work-item continuity');
    expect(layer!.content).toContain('## Board Position\nLane: In Review');
    expect(layer!.content).toContain('Review required from reviewer');
    expect(layer!.content).toContain('Mandatory review: reviewer should review the current output before completion.');
    expect(layer!.content).toContain('Next expected actor: reviewer');
    expect(layer!.content).toContain('Next expected action: review');
    expect(layer!.content).toContain('## Predecessor Context');
    expect(layer!.content).toContain('The design is ready for implementation.');
    expect(layer!.content).toContain('Upload required artifacts before completion or escalation');
  });
});
