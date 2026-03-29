import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  DashboardTaskRecord,
  DashboardWorkflowSteeringMessageRecord,
  DashboardWorkflowWorkItemRecord,
} from '../../../lib/api.js';
import type { WorkflowSteeringTargetContext } from './workflow-steering.support.js';
import {
  buildSteeringHistory,
  buildWorkflowSteeringRequestInput,
  buildWorkflowSteeringTargets,
  describeSteeringTargetDisabledReason,
  WorkflowSteering,
} from './workflow-steering.js';

describe('WorkflowSteering', () => {
  it('renders task-scoped steering copy from the current workbench scope', () => {
    const html = renderSteering();
    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Record durable requests, responses, and attachments for this task.');
    expect(html).toContain('Guide Verify deliverable toward the next legal action.');
    expect(html).toContain('Targeting task: Verify deliverable');
    expect(html).toContain('No steering history exists for this task yet.');
  });

  it('requires an explicit target choice before workflow-scoped steering can be submitted', () => {
    const html = renderSteering({
      selectedWorkItemId: null,
      selectedWorkItemTitle: null,
      selectedWorkItem: null,
      selectedTaskId: null,
      selectedTaskTitle: null,
      selectedTask: null,
      selectedWorkItemTasks: [],
      scope: createScope('workflow'),
    });
    expect(html).toContain('Steering target');
    expect(html).toContain('Choose a steering target before recording a request.');
    expect(html).toContain('Select a target');
  });

  it('offers active child tasks as explicit workflow-scope steering targets and filters paused work', () => {
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        scope: createScope('workflow'),
        selectedTaskId: null,
        selectedTaskTitle: null,
        selectedTask: null,
        selectedWorkItemTasks: [
          createTask({
            id: 'task-1',
            title: 'Verify deliverable',
            work_item_id: 'work-item-7',
            work_item_title: 'Prepare release bundle',
          }),
          createPausedTask(),
        ],
      }),
    );

    expect(options.map((option) => option.label)).toEqual([
      'Workflow: Workflow 1',
      'Work item: Prepare release bundle',
      'Task: Verify deliverable',
    ]);
  });

  it('builds task-targeted steering requests with the task id in the payload', () => {
    expect(createRequestPayload(createTarget('selected_task'))).toEqual({
      request_id: 'request-1',
      request: 'Keep the rollout limited to the current scope.',
      work_item_id: 'work-item-7',
      task_id: 'task-3',
      linked_input_packet_ids: [],
      session_id: 'session-1',
    });
  });

  it('builds work-item-targeted steering requests with the work item id in the payload', () => {
    expect(
      createRequestPayload(
        createTarget('selected_work_item', {
          selectedTaskId: null,
          selectedTaskTitle: null,
          selectedTask: null,
          selectedWorkItemTasks: [],
        }),
      ),
    ).toEqual({
      request_id: 'request-1',
      request: 'Keep the rollout limited to the current scope.',
      work_item_id: 'work-item-7',
      task_id: undefined,
      linked_input_packet_ids: [],
      session_id: 'session-1',
    });
  });

  it('excludes paused and terminal narrower targets from the workflow target picker', () => {
    const pausedTask = createPausedTask();
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        boardColumns: doneColumns(),
        scope: createScope('workflow'),
        selectedWorkItem: createWorkItem({ completed_at: '2026-03-28T04:00:00.000Z' }),
        selectedTask: pausedTask,
        selectedWorkItemTasks: [pausedTask],
      }),
    );
    expect(options.map((option) => option.label)).toEqual(['Workflow: Workflow 1']);
  });

  it('reports a clear disabled reason when the selected task is paused', () => {
    const pausedTask = createPausedTask();
    const target = createTarget('selected_task', {
      selectedTask: pausedTask,
      selectedWorkItemTasks: [pausedTask],
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'active',
        boardColumns: activeColumns(),
        target,
        selectedWorkItem: createWorkItem(),
        selectedTask: pausedTask,
        selectedWorkItemTasks: [pausedTask],
      }),
    ).toBe('This task is paused. Resume it or choose another target before steering.');
  });

  it('reports a clear disabled reason when the selected work item is completed', () => {
    const completedWorkItem = createWorkItem({
      completed_at: '2026-03-28T04:00:00.000Z',
      column_id: 'done',
    });
    const target = createTarget('selected_work_item', {
      boardColumns: doneColumns(),
      scope: createScope('selected_work_item'),
      selectedWorkItem: completedWorkItem,
      selectedTaskId: null,
      selectedTaskTitle: null,
      selectedTask: null,
      selectedWorkItemTasks: [],
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'active',
        boardColumns: doneColumns(),
        target,
        selectedWorkItem: completedWorkItem,
        selectedTask: null,
        selectedWorkItemTasks: [],
      }),
    ).toBe('This work item is already completed or cancelled. Historical work cannot be steered.');
  });

  it('omits request-recorded acknowledgements from steering history', () => {
    expect(
      buildSteeringHistory(
        [
          createMessage({
            id: 'message-1',
            source_kind: 'operator',
            message_kind: 'operator_request',
            headline: 'Tighten the approval brief.',
            body: 'Keep the scope narrow.',
            created_by_type: 'user',
            created_by_id: 'user-1',
            created_at: '2026-03-28T04:00:00.000Z',
          }),
          createMessage({
            id: 'message-2',
            source_kind: 'platform',
            message_kind: 'steering_response',
            headline: 'Steering request recorded',
            body: 'Scoped to the workflow.',
            created_by_type: 'system',
            created_by_id: 'system-1',
            created_at: '2026-03-28T04:00:01.000Z',
          }),
        ],
        [],
      ).map((entry) => entry.title),
    ).toEqual(['Tighten the approval brief.']);
  });
});

function renderSteering(overrides: Partial<Parameters<typeof WorkflowSteering>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(WorkflowSteering, createProps(overrides)),
    ),
  );
}

function createProps(
  overrides: Partial<Parameters<typeof WorkflowSteering>[0]> = {},
): Parameters<typeof WorkflowSteering>[0] {
  const task = overrides.selectedTask ?? createTask();
  return {
    workflowId: 'workflow-1',
    workflowName: 'Workflow 1',
    workflowState: 'active',
    boardColumns: activeColumns(),
    selectedWorkItemId: 'work-item-7',
    selectedWorkItemTitle: 'Prepare release bundle',
    selectedWorkItem: createWorkItem(),
    selectedTaskId: 'task-3',
    selectedTaskTitle: 'Verify deliverable',
    selectedTask: task,
    selectedWorkItemTasks: [task],
    scope: createScope('selected_task'),
    interventions: [],
    messages: [],
    sessionId: null,
    canAcceptRequest: true,
    ...overrides,
  };
}

function createTarget(
  scopeKind: WorkflowSteeringTargetContext['scope']['scopeKind'],
  overrides: Partial<WorkflowSteeringTargetContext> = {},
) {
  return buildWorkflowSteeringTargets(
    createTargetContext({ scope: createScope(scopeKind), ...overrides }),
  )[0];
}

function createTargetContext(
  overrides: Partial<WorkflowSteeringTargetContext> = {},
): WorkflowSteeringTargetContext {
  const task = overrides.selectedTask ?? createTask();
  return {
    workflowName: 'Workflow 1',
    workflowState: 'active',
    boardColumns: activeColumns(),
    scope: createScope('selected_task'),
    selectedWorkItemId: 'work-item-7',
    selectedWorkItemTitle: 'Prepare release bundle',
    selectedWorkItem: createWorkItem(),
    selectedTaskId: 'task-3',
    selectedTaskTitle: 'Verify deliverable',
    selectedTask: task,
    selectedWorkItemTasks: [task],
    ...overrides,
  };
}

function createRequestPayload(target = createTarget('selected_task')) {
  return buildWorkflowSteeringRequestInput({
    requestId: 'request-1',
    request: 'Keep the rollout limited to the current scope.',
    sessionId: 'session-1',
    target,
  });
}

function createScope(scopeKind: WorkflowSteeringTargetContext['scope']['scopeKind']) {
  if (scopeKind === 'workflow')
    return {
      scopeKind,
      title: 'Workflow' as const,
      subject: 'workflow' as const,
      name: 'Workflow 1',
      banner: 'Workflow: Workflow 1',
    };
  if (scopeKind === 'selected_work_item')
    return {
      scopeKind,
      title: 'Work item' as const,
      subject: 'work item' as const,
      name: 'Prepare release bundle',
      banner: 'Work item: Prepare release bundle',
    };
  return {
    scopeKind: 'selected_task' as const,
    title: 'Task' as const,
    subject: 'task' as const,
    name: 'Verify deliverable',
    banner: 'Task: Verify deliverable',
  };
}

function activeColumns() {
  return [{ id: 'active', label: 'Active', is_terminal: false }];
}
function doneColumns() {
  return [{ id: 'done', label: 'Done', is_terminal: true }];
}
function createPausedTask(): DashboardTaskRecord {
  return createTask({ state: 'paused' as DashboardTaskRecord['state'] });
}

function createMessage(
  overrides: Pick<
    DashboardWorkflowSteeringMessageRecord,
    | 'id'
    | 'source_kind'
    | 'message_kind'
    | 'headline'
    | 'body'
    | 'created_by_type'
    | 'created_by_id'
    | 'created_at'
  >,
): DashboardWorkflowSteeringMessageRecord {
  return {
    workflow_id: 'workflow-1',
    work_item_id: null,
    steering_session_id: 'session-1',
    linked_intervention_id: null,
    linked_input_packet_id: null,
    linked_operator_update_id: null,
    ...overrides,
  };
}

function createWorkItem(
  overrides: Partial<DashboardWorkflowWorkItemRecord> = {},
): DashboardWorkflowWorkItemRecord {
  return {
    id: 'work-item-7',
    workflow_id: 'workflow-1',
    stage_name: 'review',
    title: 'Prepare release bundle',
    column_id: 'active',
    priority: 'normal',
    completed_at: null,
    branch_status: 'active',
    ...overrides,
  };
}

function createTask(overrides: Partial<DashboardTaskRecord> = {}): DashboardTaskRecord {
  return {
    id: 'task-3',
    tenant_id: 'tenant-1',
    workflow_id: 'workflow-1',
    workspace_id: 'workspace-1',
    parent_id: null,
    title: 'Verify deliverable',
    description: null,
    state: 'in_progress',
    priority: 'normal',
    execution_backend: 'runtime_plus_task',
    used_task_sandbox: true,
    role: 'reviewer',
    role_config: {},
    environment: {},
    resource_bindings: [],
    input: {},
    output: {},
    metadata: {},
    assigned_agent_id: null,
    assigned_worker_id: null,
    depends_on: [],
    timeout_minutes: 30,
    auto_retry: false,
    max_retries: 0,
    retry_count: 0,
    claimed_at: null,
    started_at: '2026-03-28T03:00:00.000Z',
    completed_at: null,
    failed_at: null,
    cancelled_at: null,
    created_at: '2026-03-28T02:55:00.000Z',
    updated_at: '2026-03-28T03:00:00.000Z',
    workflow: { id: 'workflow-1', name: 'Workflow 1', workspace_id: 'workspace-1' },
    workflow_name: 'Workflow 1',
    workspace_name: 'Workspace',
    work_item_id: 'work-item-7',
    work_item_title: 'Prepare release bundle',
    stage_name: 'review',
    activation_id: 'activation-1',
    execution_environment: null,
    ...overrides,
  };
}
