import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  DashboardTaskRecord,
  DashboardWorkflowInterventionRecord,
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
  it('renders a work-item-only steering composer without target pickers or steering-history chrome', () => {
    const html = renderSteering();

    expect(html).toContain('Operator guidance');
    expect(html).toContain('Guide Prepare release bundle toward the next legal action.');
    expect(html).toContain('Steering attachments');
    expect(html).not.toContain('Steering target');
    expect(html).not.toContain('Target kind');
    expect(html).not.toContain('Specific work item');
    expect(html).not.toContain('Choose a steering target');
  });

  it('normalizes stale task-scoped steering into a work-item-scoped composer', () => {
    const html = renderSteering();
    expect(html).toContain('Guide Prepare release bundle toward the next legal action.');
    expect(html).toContain('Operator guidance');
    expect(html).toContain('Work item · Prepare release bundle');
    expect(html).toContain('No steering history exists for this work item yet.');
    expect(html).not.toContain('Steering target');
    expect(html).not.toContain('Target kind');
    expect(html).not.toContain('Choose a steering target');
    expect(html).not.toContain('Targeting work item: Prepare release bundle');
    expect(html).not.toContain('Task: Verify deliverable');
  });

  it('does not reintroduce target-picking chrome when rendered at workflow scope', () => {
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

    expect(html).toContain('Operator guidance');
    expect(html).toContain('Guide Workflow 1 toward the next legal action.');
    expect(html).toContain('No steering history exists for this workflow yet.');
    expect(html).not.toContain('Steering target');
    expect(html).not.toContain('Target kind');
    expect(html).not.toContain('Specific work item');
    expect(html).not.toContain('Choose where this workflow-level steering request should land.');
    expect(html).not.toContain('Choose a steering target before recording a request.');
  });

  it('offers only the eligible selected work item as a narrower workflow-scope steering target', () => {
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        scope: createScope('workflow'),
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
    ]);
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

  it('excludes paused and terminal narrower work-item and task targets from the workflow target picker', () => {
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

  it('excludes cancelled narrower targets from the workflow target picker', () => {
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        workflowState: 'cancelled',
        boardColumns: activeColumns(),
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
        ],
      }),
    );

    expect(options.map((option) => option.label)).toEqual([]);
  });

  it('reports a clear disabled reason when stale task scope resolves to a completed work item', () => {
    const completedWorkItem = createWorkItem({
      completed_at: '2026-03-28T04:00:00.000Z',
      column_id: 'done',
    });
    const target = createTarget('selected_task', {
      boardColumns: doneColumns(),
      selectedWorkItem: completedWorkItem,
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'active',
        boardColumns: doneColumns(),
        target,
        selectedWorkItem: completedWorkItem,
        selectedTask: createPausedTask(),
        selectedWorkItemTasks: [],
      }),
    ).toBe('This work item is already completed or cancelled. Historical work cannot be steered.');
  });

  it('reports the specific paused-task reason when task scope is paused', () => {
    const activeTask = createTask();
    const target = createTarget('selected_task', {
      selectedTask: createTask({ state: 'paused' as DashboardTaskRecord['state'] }),
      selectedWorkItemTasks: [createTask({ state: 'paused' as DashboardTaskRecord['state'] })],
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'active',
        boardColumns: activeColumns(),
        target,
        selectedWorkItem: createWorkItem(),
        selectedTask: createTask({ state: 'paused' as DashboardTaskRecord['state'] }),
        selectedWorkItemTasks: [createTask({ state: 'paused' as DashboardTaskRecord['state'] })],
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

  it('reports a clear disabled reason when stale task scope belongs to a cancelled workflow', () => {
    const activeTask = createTask();
    const target = createTarget('selected_task', {
      workflowState: 'cancelled',
      selectedTask: activeTask,
      selectedWorkItemTasks: [activeTask],
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'cancelled',
        boardColumns: activeColumns(),
        target,
        selectedWorkItem: createWorkItem(),
        selectedTask: activeTask,
        selectedWorkItemTasks: [activeTask],
      }),
    ).toBe('This workflow is cancelled. Historical work cannot be steered.');
  });

  it('shows the specific paused work-item reason and removes steering controls for paused scoped work', () => {
    const html = renderSteering({
      workflowState: 'paused',
      scope: createScope('selected_work_item'),
      selectedTaskId: null,
      selectedTaskTitle: null,
      selectedTask: null,
      selectedWorkItemTasks: [],
    });

    expect(html).toContain('This work item is paused. Resume it or choose another target before steering.');
    expect(html).not.toContain('Steering requests are unavailable for this workflow right now.');
    expect(html).not.toContain('Steering attachments');
    expect(html).not.toContain('Record steering request</button>');
  });

  it('shows the specific paused work-item reason and removes steering controls for stale task scope', () => {
    const pausedTask = createTask({ state: 'paused' as DashboardTaskRecord['state'] });
    const html = renderSteering({
      scope: createScope('selected_task'),
      selectedTask: pausedTask,
      selectedWorkItemTasks: [pausedTask],
    });

    expect(html).toContain('This work item is paused. Resume it or choose another target before steering.');
    expect(html).not.toContain('Steering attachments');
    expect(html).not.toContain('Record steering request</button>');
  });

  it('shows the specific workflow paused reason and removes steering controls for paused workflow scope', () => {
    const html = renderSteering({
      workflowState: 'paused',
      scope: createScope('workflow'),
      selectedWorkItemId: null,
      selectedWorkItemTitle: null,
      selectedWorkItem: null,
      selectedTaskId: null,
      selectedTaskTitle: null,
      selectedTask: null,
      selectedWorkItemTasks: [],
      canAcceptRequest: false,
    });

    expect(html).toContain('This workflow is paused. Resume it or choose another target before steering.');
    expect(html).not.toContain('Steering target');
    expect(html).not.toContain('Target kind');
  });

  it('keeps steering dense by removing nested heavy shells and session boilerplate', () => {
    const html = renderSteering({
      sessionId: 'session-1',
      messages: [
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
      ],
    });

    expect(html).toContain('Steering request');
    expect(html).toContain('Tighten the approval brief.');
    expect(html).not.toContain('Open session');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/80 p-4');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-muted/10 p-4');
  });

  it('removes steering controls for completed scoped work items', () => {
    const completedWorkItem = createWorkItem({
      completed_at: '2026-03-28T04:00:00.000Z',
      column_id: 'done',
    });
    const html = renderSteering({
      boardColumns: doneColumns(),
      scope: createScope('selected_work_item'),
      selectedWorkItem: completedWorkItem,
      selectedTaskId: null,
      selectedTaskTitle: null,
      selectedTask: null,
      selectedWorkItemTasks: [],
    });

    expect(html).toContain('This work item is already completed or cancelled. Historical work cannot be steered.');
    expect(html).not.toContain('Steering attachments');
    expect(html).not.toContain('Record steering request</button>');
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

  it('does not repeat operator request text in both the history title and body', () => {
    const [entry] = buildSteeringHistory(
      [
        createMessage({
          id: 'message-1',
          source_kind: 'operator',
          message_kind: 'operator_request',
          headline: 'Tighten the approval brief.',
          body: 'Tighten the approval brief.',
          created_by_type: 'user',
          created_by_id: 'user-1',
          created_at: '2026-03-28T04:00:00.000Z',
        }),
      ],
      [],
    );

    expect(entry.title).toBe('Tighten the approval brief.');
    expect(entry.body).toBeNull();
  });

  it('suppresses request-recorded acknowledgements even when the platform row only carries the text in body or content', () => {
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
            headline: undefined,
            body: undefined,
            content: 'Steering request recorded',
            created_by_type: 'system',
            created_by_id: 'system-1',
            created_at: '2026-03-28T04:00:01.000Z',
          }),
        ],
        [],
      ),
    ).toHaveLength(1);
  });

  it('suppresses intervention rows that only echo the same steering request text', () => {
    const entries = buildSteeringHistory(
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
      ],
      [
        createIntervention({
          id: 'intervention-1',
          summary: 'Tighten the approval brief.',
          note: 'Keep the scope narrow.',
        }),
      ],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Tighten the approval brief.');
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
    | 'content'
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

function createIntervention(
  overrides: Pick<DashboardWorkflowInterventionRecord, 'id' | 'summary' | 'note'>,
): DashboardWorkflowInterventionRecord {
  return {
    workflow_id: 'workflow-1',
    work_item_id: 'work-item-7',
    task_id: null,
    kind: 'steering_request',
    origin: 'operator',
    status: 'applied',
    structured_action: {},
    metadata: {},
    created_by_type: 'user',
    created_by_id: 'user-1',
    created_at: '2026-03-28T04:00:01.000Z',
    updated_at: '2026-03-28T04:00:01.000Z',
    files: [],
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
