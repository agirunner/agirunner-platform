import { describe, expect, it } from 'vitest';

import { buildWorkflowInstructionLayer } from '../../../src/services/workflow-instruction-layer/workflow-instruction-layer.js';

describe('buildWorkflowInstructionLayer', () => {
  it('returns null when no playbook definition is available', () => {
    expect(
      buildWorkflowInstructionLayer({
        isOrchestratorTask: false,
        workflow: {
          playbook: {},
        },
        taskInput: {},
      }),
    ).toBeNull();
  });

  it('builds specialist instructions from the workflow definition', () => {
    const result = buildWorkflowInstructionLayer({
      isOrchestratorTask: false,
      role: 'developer',
      roleConfig: { tools: ['file_read'] },
      workflow: {
        lifecycle: 'ongoing',
        variables: {
          goal: 'Ship the feature',
          repository_url: 'https://example.com/repo.git',
          token: 'secret-value',
        },
        playbook: {
          definition: {
            process_instructions: 'Developer completes the work and hands off clearly.',
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [{ name: 'implementation', goal: 'Build the work.' }],
          },
        },
      },
      workspace: {
        repository_url: 'https://example.com/repo.git',
      },
      taskInput: {
        instructions: 'Follow the task brief.',
      },
    });

    expect(result).not.toBeNull();
    expect(result?.format).toBe('markdown');
    expect(result?.content).toContain('## Workflow Mode: ongoing');
    expect(result?.content).toContain('## Completion Boundaries');
    expect(result?.content).toContain('## Output Protocol');
    expect(result?.content).toContain('Repository-backed workflow.');
    expect(result?.content).not.toContain('secret-value');
  });

  it('builds orchestrator instructions with stage routing and visibility context', () => {
    const result = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        current_stage: 'triage',
        active_stages: ['triage'],
        live_visibility: {
          mode: 'enhanced',
          milestone_briefs_required: true,
          record_operator_brief_tool: 'record_operator_brief',
          operator_brief_request_id_prefix: 'obr',
          workflow_id: 'wf-1',
          work_item_id: 'wi-1',
          task_id: 'task-1',
          execution_context_id: 'ctx-1',
        },
        playbook: {
          definition: {
            process_instructions: 'Move work through triage, implementation, and review.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'active', label: 'Active' },
              ],
            },
            stages: [
              { name: 'triage', goal: 'Triage inbound work', involves: ['triager'] },
              { name: 'implementation', goal: 'Build the work.' },
            ],
            orchestrator: {
              max_active_tasks: 2,
            },
          },
        },
      },
      workspace: {
        repository_url: 'https://example.com/repo.git',
      },
      taskInput: {
        repository: {
          repository_url: 'https://example.com/repo.git',
        },
      },
      orchestratorContext: {
        workflow: {
          role_definitions: [
            {
              name: 'triager',
              description: 'Routes incoming work.',
            },
          ],
          closure_context: {
            closure_readiness: 'ready_to_close',
            work_item_can_close_now: true,
            workflow_can_close_now: false,
            open_specialist_task_count: 0,
            open_specialist_task_roles: [],
            active_blocking_controls: [],
            active_advisory_controls: [],
            preferred_obligations: [],
            recent_recovery_outcomes: [],
            attempt_count_by_work_item: {},
            attempt_count_by_role: {},
            recent_failures: [],
            reroute_candidates: [],
          },
        },
        activation: {
          payload: {
            stage_name: 'triage',
            previous_stage_name: 'intake',
          },
        },
        board: {
          work_items: [
            {
              id: 'wi-1',
              stage_name: 'triage',
              next_expected_actor: 'triager',
              next_expected_action: 'review',
              continuity: {
                status_summary: 'waiting',
                next_expected_event: 'dispatch',
                active_subordinate_tasks: ['task-2'],
              },
              rework_count: 1,
              blocked_state: 'blocked',
              escalation_status: 'open',
            },
          ],
          tasks: [
            {
              id: 'task-1',
              role: 'triager',
              title: 'Review work',
              next_expected_actor: 'triager',
              next_expected_action: 'review',
            },
          ],
          pending_dispatches: [
            {
              work_item_id: 'wi-1',
              stage_name: 'triage',
              actor: 'triager',
              action: 'assess',
              title: 'Review work',
            },
          ],
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.format).toBe('markdown');
    expect(result?.content).toContain('## Workflow Mode: planned');
    expect(result?.content).toContain('## Stage Routing');
    expect(result?.content).toContain('## Stage Role Coverage');
    expect(result?.content).toContain('## Pending Dispatches');
    expect(result?.content).toContain('## Operator Visibility');
    expect(result?.content).toContain('triager');
    expect(result?.content).toContain('Next expected actor: triager');
    expect(result?.content).toContain('Repository-backed workflow.');
  });

  it('tells empty planned stages to seed real work instead of waiting on the orchestrator task', () => {
    const result = buildWorkflowInstructionLayer({
      isOrchestratorTask: true,
      workflow: {
        lifecycle: 'planned',
        current_stage: 'reproduce',
        active_stages: ['reproduce'],
        playbook: {
          definition: {
            process_instructions: 'Move work through reproduce and implement.',
            board: {
              columns: [
                { id: 'planned', label: 'Planned' },
                { id: 'active', label: 'Active' },
              ],
            },
            stages: [
              { name: 'reproduce', goal: 'Bound the defect', involves: ['developer'] },
              { name: 'implement', goal: 'Ship the fix', involves: ['developer'] },
            ],
          },
        },
      },
      taskInput: {},
      orchestratorContext: {
        activation: {
          payload: {
            stage_name: 'reproduce',
          },
        },
        board: {
          work_items: [],
          tasks: [],
          pending_dispatches: [],
        },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.content).toContain('## Successor Seeding');
    expect(result?.content).toContain('If list_work_items returns no work items in "reproduce" and list_workflow_tasks returns no non-orchestrator tasks for that stage, create the first work item and starter specialist task now');
    expect(result?.content).toContain('Active subordinate work means real work items and non-orchestrator specialist tasks, never the current orchestrator task itself.');
    expect(result?.content).toContain('Do not use read_task_status on the current orchestrator task id as evidence that stage work already exists.');
  });
});
