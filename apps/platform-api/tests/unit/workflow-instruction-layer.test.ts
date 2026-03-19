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
              { name: 'verification', goal: 'QA validates the change' },
            ],
            review_rules: [
              { from_role: 'developer', reviewed_by: 'reviewer', checkpoint: 'implementation', required: true },
              { from_role: 'reviewer', reviewed_by: 'qa', checkpoint: 'review', required: true },
            ],
            handoff_rules: [
              { from_role: 'developer', to_role: 'reviewer', checkpoint: 'implementation', required: true },
              { from_role: 'reviewer', to_role: 'qa', checkpoint: 'review', required: true },
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
              stage_name: 'review',
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
    expect(layer!.content).toContain('## Current Stage\nreview');
    expect(layer!.content).toContain('Human gate: yes');
    expect(layer!.content).toContain('## Stage Routing');
    expect(layer!.content).toContain('Successor stage after acceptance: verification');
    expect(layer!.content).toContain(
      `Creating successor work in "verification" and closing the accepted predecessor work item is itself the forward-routing mutation for this planned workflow.`,
    );
    expect(layer!.content).toContain(
      `If the platform already reports "verification" as current after you route successor work, treat any repeated advance_stage request for "review" -> "verification" as unnecessary and do not issue it again.`,
    );
    expect(layer!.content).toContain(
      'Only create successor checkpoint work for the immediate next stage after the predecessor checkpoint has a full handoff or approved gate and no actively running tasks; output_pending_review is the only allowed carryover, and only for a required review checkpoint.',
    );
    expect(layer!.content).toContain(
      'Before you create successor specialist tasks in a planned workflow, create or move the successor work item into the successor stage first.',
    );
    expect(layer!.content).toContain(
      'Planned-workflow tasks must stay attached to a work item in the same stage as the task itself.',
    );
    expect(layer!.content).toContain('## Rule Results');
    expect(layer!.content).toContain('Next expected actor: human');
    expect(layer!.content).toContain('Next expected action: approve');
    expect(layer!.content).toContain('Human approval required before completion.');
    expect(layer!.content).toContain('Required review: reviewer -> qa');
    expect(layer!.content).toContain('Required handoff: reviewer -> qa');
    expect(layer!.content).not.toContain('Required review: developer -> reviewer');
    expect(layer!.content).not.toContain('Required handoff: developer -> reviewer');
    expect(layer!.content).toContain('## Activation Discipline');
    expect(layer!.content).toContain('finish this activation and wait for the next workflow event');
    expect(layer!.content).toContain('Do not poll running tasks in a loop.');
    expect(layer!.content).toContain('If no subordinate work is active and the workflow should progress, perform the workflow mutation now.');
    expect(layer!.content).toContain('A recommendation without the required workflow mutation does not complete the activation.');
    expect(layer!.content).toContain('## Parallelism');
    expect(layer!.content).toContain('Max active tasks: 4');
    expect(layer!.content).toContain('Repository-backed workflow. Inspect files, diffs, and git state before deciding. Once required work is dispatched');
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

  it('surfaces the workflow goal and launch inputs without echoing secret-like values', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: false,
      role: 'developer',
      workflow: {
        lifecycle: 'planned',
        variables: {
          goal: 'Deliver a Hello World CLI with automated tests.',
          repository_url: 'https://github.com/example/repo',
          branch: 'feature/hello-world',
          git_token_secret_ref: 'secret:GITHUB_TOKEN',
        },
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Implement the requested deliverable exactly and route code through review.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'implementation', goal: 'Build the requested deliverable' },
            ],
            review_rules: [
              { from_role: 'developer', reviewed_by: 'reviewer', checkpoint: 'implementation', required: true },
            ],
          },
        },
      },
      workItem: {
        stage_name: 'implementation',
        column_id: 'planned',
        owner_role: 'developer',
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Workflow Brief');
    expect(layer!.content).toContain('Goal: Deliver a Hello World CLI with automated tests.');
    expect(layer!.content).toContain('- repository_url: https://github.com/example/repo');
    expect(layer!.content).toContain('- branch: feature/hello-world');
    expect(layer!.content).not.toContain('git_token_secret_ref');
    expect(layer!.content).not.toContain('secret:GITHUB_TOKEN');
  });

  it('prefers a sole active checkpoint over stale workflow-global current stage fallback', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        current_stage: 'review',
        active_stages: ['implementation'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Follow the checkpoint sequence.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'implementation', goal: 'Build the requested change' },
              { name: 'review', goal: 'Review the requested change', human_gate: true },
            ],
          },
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Current Stage\nimplementation');
    expect(layer!.content).not.toContain('## Current Stage\nreview');
  });

  it('follows the activation stage anchor instead of drifting back to older work items', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        current_stage: 'fix',
        active_stages: ['fix'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Reproduce the issue, fix it, then verify it.',
            board: {
              columns: [
                { id: 'active', label: 'Active' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'reproduce', goal: 'Confirm the issue' },
              { name: 'fix', goal: 'Implement the fix' },
              { name: 'verify', goal: 'Verify the fix' },
            ],
          },
        },
      },
      orchestratorContext: {
        activation: {
          payload: {
            stage_name: 'fix',
          },
        },
        board: {
          work_items: [
            {
              id: 'wi-reproduce',
              stage_name: 'reproduce',
              column_id: 'active',
              next_expected_actor: 'developer',
              next_expected_action: 'reproduce',
              rework_count: 0,
            },
            {
              id: 'wi-fix',
              stage_name: 'fix',
              column_id: 'active',
              next_expected_actor: 'developer',
              next_expected_action: 'implement',
              rework_count: 1,
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Current Stage\nfix');
    expect(layer!.content).not.toContain('## Current Stage\nreproduce');
    expect(layer!.content).toContain('Next expected action: implement');
    expect(layer!.content).not.toContain('Next expected action: reproduce');
    expect(layer!.content).toContain('Current rework count: 1');
    expect(layer!.content).not.toContain('Current rework count: 0');
  });
});
