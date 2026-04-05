import type { TaskContextRow, TaskHandoffRow } from '../../../src/services/handoff-service/handoff-service.types.js';

export function makeTaskRow(overrides: Partial<TaskContextRow> = {}): TaskContextRow {
  return {
    id: 'task-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    workspace_id: 'workspace-1',
    work_item_id: 'work-item-1',
    role: 'developer',
    stage_name: 'implementation',
    state: 'in_progress',
    rework_count: 0,
    is_orchestrator_task: false,
    input: {},
    metadata: { team_name: 'delivery' },
    ...overrides,
  };
}

export function makeHandoffRow(overrides: Partial<TaskHandoffRow> = {}): TaskHandoffRow {
  return {
    id: 'handoff-1',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-1',
    task_id: 'task-1',
    task_rework_count: 0,
    request_id: 'req-1',
    role: 'developer',
    team_name: 'delivery',
    stage_name: 'implementation',
    sequence: 0,
    summary: 'Implemented auth flow.',
    completion: 'full',
    completion_state: 'full',
    resolution: null,
    decision_state: null,
    closure_effect: null,
    changes: [],
    decisions: [],
    remaining_items: [],
    blockers: [],
    focus_areas: [],
    known_risks: [],
    recommended_next_actions: [],
    waived_steps: [],
    completion_callouts: {},
    successor_context: null,
    role_data: {},
    subject_ref: null,
    subject_revision: null,
    outcome_action_applied: null,
    branch_id: null,
    artifact_ids: [],
    created_at: new Date('2026-03-15T12:00:00Z'),
    ...overrides,
  };
}
