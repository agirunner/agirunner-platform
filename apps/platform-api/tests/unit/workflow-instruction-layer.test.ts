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
    expect(layer!.content).toContain(
      'include final_artifacts with the repo-relative deliverables or uploaded artifact paths that represent the final workflow output.',
    );
    expect(layer!.content).toContain('## Guided Recovery');
    expect(layer!.content).toContain('retry transient failures');
    expect(layer!.content).toContain('close with callouts if closure is legal');
    expect(layer!.content).toContain('## Available Roles');
    expect(layer!.content).toContain('- reviewer: Reviews implementation quality and correctness.');
    expect(layer!.content).toContain('## Parallelism');
    expect(layer!.content).toContain('Max active tasks: 4');
    expect(layer!.content).toContain('send_task_message never creates or reopens a task and is not a routing mutation.');
    expect(layer!.content).toContain(
      'Do not describe rework as routed until create_task succeeds for a new rework task or update_task_input succeeds on the already-open task.',
    );
    expect(layer!.content).toContain('Repository-backed workflow. Use runtime-visible continuity, task outputs, and artifacts to decide what specialist work to dispatch next.');
    expect(layer!.content).not.toContain('Inspect files, diffs, and git state before deciding.');
    expect(layer!.content).not.toContain('Human gate: yes');
  });

  it('renders closure context and recovery history for orchestrator tasks', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['review'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions:
              'Drive the workflow to a reasonable conclusion even if preferred review steps become advisory.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [
              { name: 'review', goal: 'Review the accepted change', involves: ['reviewer', 'brand-reviewer'] },
            ],
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
              column_id: 'planned',
              next_expected_actor: 'reviewer',
              next_expected_action: 'approve',
              rework_count: 1,
            },
          ],
          tasks: [
            {
              id: 'task-review-1',
              role: 'reviewer',
              work_item_id: 'wi-1',
              stage_name: 'review',
              state: 'completed',
              is_orchestrator_task: false,
              metadata: { task_kind: 'assessment' },
              input: { subject_revision: 2 },
            },
          ],
        },
          closure_context: {
            workflow_can_close_now: false,
            work_item_can_close_now: false,
            active_blocking_controls: [],
            active_advisory_controls: [
              {
              kind: 'escalation',
              id: 'esc-1',
              closure_effect: 'advisory',
              summary: 'Editorial escalation remains advisory.',
            },
          ],
          preferred_obligations: [
            {
              code: 'stage_role_contribution',
              status: 'unmet',
              subject: 'brand-reviewer',
            },
          ],
            closure_readiness: 'can_close_with_callouts',
            open_specialist_task_count: 1,
            open_specialist_task_roles: ['editorial-policy-assessor'],
            recent_recovery_outcomes: [
              {
                recovery_class: 'predecessor_missing_handoff',
              suggested_next_actions: [
                {
                  action_code: 'rerun_predecessor_for_handoff',
                  target_type: 'task',
                  target_id: 'task-123',
                  why: 'the predecessor task exited without a full handoff',
                  requires_orchestrator_judgment: true,
                },
              ],
            },
          ],
          attempt_count_by_work_item: { 'wi-1': 2 },
          attempt_count_by_role: { reviewer: 1, 'brand-reviewer': 0 },
          recent_failures: [
            {
              task_id: 'task-brand-1',
              role: 'brand-reviewer',
              state: 'failed',
              why: 'workspace dependency missing',
            },
          ],
          last_retry_reason: 'workspace dependency missing',
          retry_window: {
            retry_available_at: '2026-03-24T10:15:00.000Z',
            backoff_seconds: 60,
          },
          reroute_candidates: ['brand-reviewer', 'editor'],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Closure Context');
    expect(layer!.content).toContain('Closure readiness: can_close_with_callouts');
    expect(layer!.content).toContain('Work item can close now: no');
    expect(layer!.content).toContain('Workflow can close now: no');
    expect(layer!.content).toContain('Open specialist tasks on current work item: 1');
    expect(layer!.content).toContain('Open specialist task roles: editorial-policy-assessor');
    expect(layer!.content).toContain('Advisory control escalation esc-1: Editorial escalation remains advisory.');
    expect(layer!.content).toContain('Preferred obligation brand-reviewer (stage_role_contribution): unmet');
    expect(layer!.content).toContain('Recent recovery predecessor_missing_handoff');
    expect(layer!.content).toContain('Attempt counts by work item: wi-1=2');
    expect(layer!.content).toContain('Attempt counts by role: reviewer=1, brand-reviewer=0');
    expect(layer!.content).toContain('Recent failure brand-reviewer on task-brand-1: workspace dependency missing');
    expect(layer!.content).toContain('Retry window: available at 2026-03-24T10:15:00.000Z after 60 seconds');
    expect(layer!.content).toContain('Reroute candidates: brand-reviewer, editor');
  });

  it('renders the orchestrator live-visibility contract with exact operator update fields', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['review'],
        live_visibility: {
          mode: 'enhanced',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: null,
          execution_context_id: 'activation-1',
          source_kind: 'orchestrator',
          record_operator_update_tool: 'record_operator_update',
          record_operator_brief_tool: 'record_operator_brief',
          turn_updates_required: true,
          turn_update_scope: 'per_eligible_turn',
          eligible_turn_guidance:
            'Emit one operator update after every eligible turn that inspects workflow state and then routes work, requests review or approval, reports waiting progress, or finishes with a concrete noop or next-step decision.',
          operator_update_request_id_prefix: 'operator-update:activation-1:',
          operator_brief_request_id_prefix: 'operator-brief:activation-1:',
          milestone_briefs_required: true,
        },
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions: 'Route work through review.',
            board: {
              columns: [{ id: 'review', label: 'In Review' }],
            },
            stages: [{ name: 'review', goal: 'Review the accepted change' }],
          },
        },
      },
      orchestratorContext: {
        activation: { payload: { work_item_id: 'work-item-1' } },
        board: {
          work_items: [
            {
              id: 'work-item-1',
              stage_name: 'review',
              column_id: 'review',
              next_expected_actor: 'reviewer',
              next_expected_action: 'assess',
              rework_count: 0,
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Operator Visibility');
    expect(layer!.content).toContain('Live visibility mode: enhanced');
    expect(layer!.content).toContain('Workflow id: workflow-1');
    expect(layer!.content).toContain('Work item id: work-item-1');
    expect(layer!.content).toContain('Execution context id: activation-1');
    expect(layer!.content).toContain(
      'Enhanced live visibility requires one record_operator_update on every eligible turn.',
    );
    expect(layer!.content).toContain(
      'Use operator-update:activation-1: as the stable request_id prefix for record_operator_update writes in this execution context.',
    );
    expect(layer!.content).toContain(
      'Use brief_kind milestone for in-flight progress or handoff summaries and brief_kind terminal only for the final workflow outcome summary.',
    );
    expect(layer!.content).toContain(
      'record_operator_brief and record_operator_update do not satisfy a required submit_handoff and do not by themselves complete a task, work item, or workflow.',
    );
    expect(layer!.content).toContain(
      'If you do not have the exact scoped workflow, work-item, or task ids from the live visibility contract, omit those optional ids and let the runtime derive the canonical linkage from execution_context_id.',
    );
    expect(layer!.content).toContain(
      'Example: { request_id: "operator-update:activation-1:route-reviewer", execution_context_id: "activation-1", work_item_id: "work-item-1", source_kind: "orchestrator", payload: { headline: "Orchestrator is routing the next specialist task." } }',
    );
  });

  it('tells the orchestrator that restrictive findings do not satisfy missing same-stage roles', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        active_stages: ['draft-revision'],
        playbook: {
          definition: {
            lifecycle: 'planned',
            process_instructions:
              'Keep the stage open until all named stage roles have contributed or been intentionally skipped for a concrete playbook-grounded reason.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'active', label: 'Active' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [
              {
                name: 'draft-revision',
                goal: 'Implementation revisions are assessed.',
                involves: ['author', 'quality-assessor', 'brand-assessor'],
              },
            ],
          },
        },
      },
      orchestratorContext: {
        activation: { payload: { work_item_id: 'wi-1', stage_name: 'draft-revision' } },
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'draft-revision',
              column_id: 'planned',
              current_subject_revision: 2,
              escalation_status: 'open',
              next_expected_actor: null,
              next_expected_action: null,
            },
          ],
          tasks: [
            {
              id: 'task-author-2',
              role: 'author',
              work_item_id: 'wi-1',
              stage_name: 'draft-revision',
              state: 'completed',
              is_orchestrator_task: false,
              metadata: { task_kind: 'code' },
              input: {},
            },
            {
              id: 'task-quality-2',
              role: 'quality-assessor',
              work_item_id: 'wi-1',
              stage_name: 'draft-revision',
              state: 'completed',
              is_orchestrator_task: false,
              metadata: { task_kind: 'assessment' },
              input: { subject_revision: 2 },
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Stage Role Coverage');
    expect(layer!.content).toContain('- author: completed task recorded on the current work item.');
    expect(layer!.content).toContain('- quality-assessor: completed current-subject assessment recorded on the current work item.');
    expect(layer!.content).toContain('- brand-assessor: no current task or recorded contribution yet on the current work item.');
    expect(layer!.content).toContain(
      'An open escalation or other restrictive same-stage finding does not by itself satisfy the remaining current-stage roles.',
    );
    expect(layer!.content).toContain(
      'Use the work item escalation status and structured handoffs as authoritative evidence of an active escalation; do not require direct escalation-record inspection before honoring it.',
    );
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

  it('tells ongoing orchestrator activations to explicitly complete accepted work items', () => {
    const layer = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'ongoing',
        active_stages: ['intake-triage'],
        playbook: {
          definition: {
            lifecycle: 'ongoing',
            process_instructions:
              'Keep intake moving and close each intake item explicitly once the authored goal is satisfied.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'active', label: 'In Progress' },
                { id: 'done', label: 'Done', is_terminal: true },
              ],
            },
            stages: [{ name: 'intake-triage', goal: 'Triaged items are assessed and closed.' }],
          },
        },
      },
      orchestratorContext: {
        activation: { payload: { work_item_id: 'wi-1', stage_name: 'intake-triage' } },
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'intake-triage',
              column_id: 'active',
              next_expected_actor: null,
              next_expected_action: null,
              rework_count: 0,
            },
          ],
        },
      },
    });

    expect(layer).not.toBeNull();
    expect(layer!.content).toContain('## Closure Discipline');
    expect(layer!.content).toContain(
      'When the current ongoing-workflow work item satisfies its authored stage goal, board posture, continuity, and process instructions, call complete_work_item in the same activation instead of leaving accepted work open.',
    );
    expect(layer!.content).toContain(
      'Do not keep accepted ongoing work items open just because the workflow itself remains available for future intake.',
    );
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
