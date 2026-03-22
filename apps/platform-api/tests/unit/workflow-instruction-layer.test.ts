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
            assessment_rules: [
              { subject_role: 'developer', assessed_by: 'reviewer', checkpoint: 'implementation', required: true },
              { subject_role: 'reviewer', assessed_by: 'qa', checkpoint: 'review', required: true },
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
        workflow: {
          role_definitions: [
            { name: 'developer', description: 'Implements the requested change.' },
            { name: 'reviewer', description: 'Reviews implementation quality and correctness.' },
            { name: 'qa', description: 'Validates behavior before release.' },
          ],
        },
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'review',
              column_id: 'review',
              next_expected_actor: 'human',
              next_expected_action: 'approve',
              rework_count: 1,
              continuity: {
                status_summary: 'A release specialist is already packaging artifacts.',
                next_expected_event: 'task.handoff_submitted',
                active_subordinate_tasks: ['task-release-1'],
              },
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
      'Only create successor checkpoint work for the immediate next stage after the predecessor checkpoint has a full handoff or approved gate and no actively running tasks; output_pending_assessment is the only allowed carryover, and only while a required assessment remains pending for the current subject.',
    );
    expect(layer!.content).toContain(
      'Before you create successor specialist tasks in a planned workflow, create or move the successor work item into the successor stage first.',
    );
    expect(layer!.content).toContain(
      'Planned-workflow tasks must stay attached to a work item in the same stage as the task itself.',
    );
    expect(layer!.content).toContain(
      'If a request_changes outcome already reopened the subject task, do not create another same-role rework task on the assessor work item; wait for the reopened subject to resubmit and then route it through the required follow-up step.',
    );
    expect(layer!.content).toContain('## Rule Results');
    expect(layer!.content).toContain('Next expected actor: human');
    expect(layer!.content).toContain('Next expected action: approve');
    expect(layer!.content).toContain('Continuity status: A release specialist is already packaging artifacts.');
    expect(layer!.content).toContain('Next expected event: task.handoff_submitted');
    expect(layer!.content).toContain('Active subordinate tasks: task-release-1');
    expect(layer!.content).toContain(
      'When active subordinate tasks are already in flight and continuity identifies the next expected event, finish this activation and wait for that event instead of polling for completion.',
    );
    expect(layer!.content).toContain('Human approval required before completion.');
    expect(layer!.content).toContain('Required assessment: reviewer -> qa');
    expect(layer!.content).not.toContain('Required handoff: reviewer -> qa');
    expect(layer!.content).not.toContain('Required assessment: developer -> reviewer');
    expect(layer!.content).not.toContain('Required handoff: developer -> reviewer');
    expect(layer!.content).toContain('## Handoff Semantics');
    expect(layer!.content).toContain('Planned-workflow handoff rules describe the structured handoff that must exist before successor-stage routing.');
    expect(layer!.content).toContain('They do not authorize dispatching successor-role tasks on the current stage work item.');
    expect(layer!.content).toContain('Create or move successor work into the next stage before dispatching successor-role specialists.');
    expect(layer!.content).toContain('## Activation Discipline');
    expect(layer!.content).toContain('finish this activation and wait for the next workflow event');
    expect(layer!.content).toContain('Do not poll running tasks in a loop.');
    expect(layer!.content).toContain('If no subordinate work is active and the workflow should progress, perform the workflow mutation now.');
    expect(layer!.content).toContain('A recommendation without the required workflow mutation does not complete the activation.');
    expect(layer!.content).toContain('## Available Roles');
    expect(layer!.content).toContain('- developer: Implements the requested change.');
    expect(layer!.content).toContain('- reviewer: Reviews implementation quality and correctness.');
    expect(layer!.content).toContain('## Parallelism');
    expect(layer!.content).toContain('Max active tasks: 4');
    expect(layer!.content).toContain('Repository-backed workflow. Inspect files, diffs, and git state before deciding. Once required work is dispatched');
    expect(layer!.content).not.toContain('mandatory reviews and approvals');
    expect(layer!.content).not.toContain('required review checkpoint');
    expect(layer!.content).not.toContain('reviewed task');
  });

  it('builds ongoing specialist durable guidance without task-scoped workflow brief or predecessor context', () => {
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
            assessment_rules: [
              { subject_role: 'developer', assessed_by: 'reviewer', required: true },
            ],
          },
        },
      },
      workItem: {
        column_id: 'review',
        owner_role: 'developer',
        next_expected_actor: 'reviewer',
        next_expected_action: 'assess',
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
    expect(layer!.content).toContain('Upload required artifacts before completion or escalation');
    expect(layer!.content).not.toContain('## Board Position');
    expect(layer!.content).not.toContain('## Review Expectations');
    expect(layer!.content).not.toContain('## Predecessor Context');
    expect(layer!.content).not.toContain('The design is ready for implementation.');
    expect(layer!.content).not.toContain('## Workflow Brief');
  });

  it('does not surface specialist workflow brief content in the flattened workflow instruction layer', () => {
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
            assessment_rules: [
              { subject_role: 'developer', assessed_by: 'reviewer', checkpoint: 'implementation', required: true },
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
    expect(layer!.content).not.toContain('## Workflow Brief');
    expect(layer!.content).not.toContain('Goal: Deliver a Hello World CLI with automated tests.');
    expect(layer!.content).not.toContain('- repository_url: https://github.com/example/repo');
    expect(layer!.content).not.toContain('- branch: feature/hello-world');
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

  it('surfaces pending dispatches when a different open work item is waiting for a specialist task', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['implementation', 'review'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Implement, review, and verify the change.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'implementation', goal: 'Build the change' },
              { name: 'review', goal: 'Review the change' },
              { name: 'verification', goal: 'Verify the change' },
            ],
            assessment_rules: [
              { subject_role: 'developer', assessed_by: 'reviewer', checkpoint: 'implementation', required: true },
            ],
          },
        },
      },
      orchestratorContext: {
        activation: { payload: { work_item_id: 'implementation-item', stage_name: 'implementation' } },
        board: {
          work_items: [
            {
              id: 'implementation-item',
              stage_name: 'implementation',
              column_id: 'planned',
              next_expected_actor: 'developer',
              next_expected_action: 'rework',
              rework_count: 2,
            },
            {
              id: 'review-item',
              stage_name: 'review',
              column_id: 'planned',
              next_expected_actor: 'reviewer',
              next_expected_action: 'assess',
              rework_count: 0,
            },
          ],
          pending_dispatches: [
            {
              work_item_id: 'review-item',
              stage_name: 'review',
              actor: 'reviewer',
              action: 'assess',
              title: 'Review the change',
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Pending Dispatches');
    expect(layer!.content).toContain('Dispatch reviewer for assess on work item review-item (review) titled "Review the change".');
    expect(layer!.content).toContain('If a pending dispatch is listed and no matching specialist task is already open, create that task in this activation.');
    expect(layer!.content).toContain('A predecessor task remaining in output_pending_assessment is expected while required assessment is pending and does not block dispatching the listed required assessment task.');
  });

  it('tells the orchestrator to seed an empty started planned stage from predecessor lineage', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['publication-release'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Draft, assess, approve, then publish.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            checkpoints: [
              { name: 'draft-package', goal: 'Prepare the draft package' },
              { name: 'operator-approval', goal: 'Record a human decision', human_gate: true },
              { name: 'publication-release', goal: 'Finalize the publication packet' },
            ],
            handoff_rules: [
              { from_role: 'fact-check-assessor', to_role: 'publication-editor', checkpoint: 'operator-approval', required: true },
            ],
          },
        },
      },
      orchestratorContext: {
        activation: {
          payload: {
            stage_name: 'publication-release',
            previous_stage_name: 'operator-approval',
          },
        },
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'draft-package',
              column_id: 'done',
              owner_role: 'research-lead',
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Current Stage\npublication-release');
    expect(layer!.content).toContain('## Successor Seeding');
    expect(layer!.content).toContain('No work item currently exists in "publication-release".');
    expect(layer!.content).toContain('This stage was entered from "operator-approval"');
    expect(layer!.content).toContain('creating the first successor work item in "publication-release"');
    expect(layer!.content).toContain('Do not escalate solely because the newly started planned stage is empty.');
  });

  it('tells the orchestrator to start an empty planned stage with checkpoint starter roles only', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['briefing'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Research first, then edit.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [
              {
                name: 'briefing',
                goal: 'Produce the final publication brief',
                involves: ['market-researcher', 'managing-editor'],
              },
            ],
            checkpoints: [
              { name: 'briefing', goal: 'Produce the final publication brief' },
            ],
            handoff_rules: [
              { from_role: 'market-researcher', to_role: 'managing-editor', required: true },
            ],
          },
        },
      },
      orchestratorContext: {
        activation: {
          payload: {
            stage_name: 'briefing',
          },
        },
        board: {
          work_items: [],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Successor Seeding');
    expect(layer!.content).toContain('Checkpoint starter roles for "briefing": market-researcher.');
    expect(layer!.content).toContain("Do not seed the first work item in \"briefing\" with successor-only roles that require an intra-stage handoff first.");
  });
});
