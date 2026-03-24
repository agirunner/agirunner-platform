import { describe, expect, it } from 'vitest';

import { buildWorkflowInstructionLayer } from '../../src/services/workflow-instruction-layer.js';

describe('buildWorkflowInstructionLayer', () => {
  it('builds planned orchestrator guidance from stages, prose, and actual continuity', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['review'],
        variables: { repository_url: 'https://github.com/example/repo' },
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions:
              'Developer implements, reviewer reviews, QA verifies, and the orchestrator should invoke approvals or escalations only when the process calls for them.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'review', label: 'In Review' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [
              { name: 'implementation', goal: 'Build the change', involves: ['developer'] },
              { name: 'review', goal: 'Review the accepted change', involves: ['reviewer'] },
              { name: 'verification', goal: 'Verify the accepted change', involves: ['qa'] },
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
          pending_dispatches: [
            {
              work_item_id: 'wi-2',
              stage_name: 'verification',
              actor: 'qa',
              action: 'verify',
              title: 'Verify the change',
            },
          ],
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'review',
              column_id: 'review',
              next_expected_actor: 'human',
              next_expected_action: 'approve',
              blocked_state: 'awaiting_decision',
              escalation_status: null,
              rework_count: 1,
              continuity: {
                status_summary: 'A publication specialist is packaging artifacts.',
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
    expect(layer!.content).toContain('## Progress Model\nStage-and-board driven');
    expect(layer!.content).toContain('## Current Stage\nreview');
    expect(layer!.content).toContain('## Stage Routing');
    expect(layer!.content).toContain('Successor stage after acceptance: verification');
    expect(layer!.content).toContain('## Stage Name Contract');
    expect(layer!.content).toContain('Use only these exact authored stage_name values when routing work: implementation, review, verification.');
    expect(layer!.content).toContain('## Active Continuity');
    expect(layer!.content).toContain('Next expected actor: human');
    expect(layer!.content).toContain('Next expected action: approve');
    expect(layer!.content).toContain('Continuity status: A publication specialist is packaging artifacts.');
    expect(layer!.content).toContain('Blocked state: awaiting_decision');
    expect(layer!.content).toContain('## Pending Dispatches');
    expect(layer!.content).toContain('Dispatch qa for verify on work item wi-2 (verification) titled "Verify the change".');
    expect(layer!.content).toContain('## Handoff Semantics');
    expect(layer!.content).toContain('Only actual invoked approvals, assessments, and escalations create blocking workflow state.');
    expect(layer!.content).toContain('## Closure Discipline');
    expect(layer!.content).toContain('call complete_work_item in the same activation');
    expect(layer!.content).toContain('call complete_workflow in the same activation');
    expect(layer!.content).toContain('## Available Roles');
    expect(layer!.content).toContain('- reviewer: Reviews implementation quality and correctness.');
    expect(layer!.content).toContain('## Parallelism');
    expect(layer!.content).toContain('Max active tasks: 4');
    expect(layer!.content).toContain('Repository-backed workflow. Use runtime-visible continuity, task outputs, and artifacts to decide what specialist work to dispatch next.');
    expect(layer!.content).not.toContain('Inspect files, diffs, and git state before deciding.');
    expect(layer!.content).not.toContain('Human gate: yes');
  });

  it('builds ongoing specialist guidance without flattening workflow brief or predecessor prose', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: false,
      role: 'developer',
      workflow: {
        lifecycle: 'ongoing',
        playbook: {
          definition: {
            lifecycle: 'ongoing',
            process_instructions:
              'Keep intake moving, use explicit approvals or assessments only when the process truly needs them, and leave clear evidence for the next actor.',
            board: {
              columns: [
                { id: 'inbox', label: 'Inbox' },
                { id: 'review', label: 'In Review' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [{ name: 'delivery', goal: 'Deliver useful progress.' }],
          },
        },
      },
      workItem: {
        stage_name: 'delivery',
        column_id: 'review',
        owner_role: 'developer',
        next_expected_actor: 'reviewer',
        next_expected_action: 'handoff',
      },
      predecessorHandoff: {
        role: 'architect',
        summary: 'The design is ready for implementation.',
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Workflow Mode: ongoing');
    expect(layer!.content).toContain('## Progress Model\nStage-and-board driven');
    expect(layer!.content).toContain('## Completion Boundaries');
    expect(layer!.content).toContain('Submitting a handoff does not itself close the work item or workflow.');
    expect(layer!.content).toContain('## Output Protocol\nNon-repository task.');
    expect(layer!.content).not.toContain('## Workflow Brief');
    expect(layer!.content).not.toContain('## Predecessor Context');
  });

  it('prefers the sole active stage over stale workflow current_stage fallback', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        current_stage: 'review',
        active_stages: ['implementation'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Follow the authored stage sequence.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [
              { name: 'implementation', goal: 'Build the requested change' },
              { name: 'review', goal: 'Review the requested change' },
            ],
          },
        },
      },
      orchestratorContext: {
        board: {
          work_items: [{ id: 'wi-1', stage_name: 'implementation', column_id: 'planned' }],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Current Stage\nimplementation');
    expect(layer!.content).not.toContain('## Current Stage\nreview');
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
            process_instructions: 'Draft the package, release it, and keep the stage flow clean.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [
              { name: 'draft-package', goal: 'Prepare the release package', involves: ['editor'] },
              { name: 'publication-release', goal: 'Release the package', involves: ['publisher', 'release-coordinator'] },
            ],
          },
        },
      },
      orchestratorContext: {
        activation: {
          payload: {
            stage_name: 'publication-release',
            previous_stage_name: 'draft-package',
          },
        },
        board: {
          work_items: [],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Current Stage\npublication-release');
    expect(layer!.content).toContain('## Successor Seeding');
    expect(layer!.content).toContain('This stage was entered from "draft-package"');
    expect(layer!.content).toContain('Starter roles for "publication-release": publisher, release-coordinator.');
  });

  it('keeps specialist output protocol non-repository when only runtime-owned tools are allowed', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: false,
      role: 'planning-analyst',
      roleConfig: {
        tools: ['memory_read', 'memory_search', 'memory_write', 'submit_handoff', 'read_predecessor_handoff'],
      },
      workflow: {
        lifecycle: 'planned',
        variables: {
          repository_url: 'https://github.com/example/repo',
        },
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Analyze the task and leave a structured handoff.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [{ name: 'planning', goal: 'Plan the requested work.' }],
          },
        },
      },
      workspace: {
        repository_url: 'https://github.com/example/repo',
      },
      workItem: {
        stage_name: 'planning',
        column_id: 'planned',
      },
    } as any);

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Output Protocol\nNon-repository task.');
    expect(layer!.content).not.toContain('Repository-backed task.');
  });
});
