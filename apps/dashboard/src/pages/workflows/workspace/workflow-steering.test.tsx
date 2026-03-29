import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardTaskRecord, DashboardWorkflowWorkItemRecord } from '../../../lib/api.js';
import {
  buildWorkflowSteeringRequestInput,
  buildWorkflowSteeringTargets,
  describeSteeringTargetDisabledReason,
  WorkflowSteering,
} from './workflow-steering.js';

describe('WorkflowSteering', () => {
  it('renders task-scoped steering copy from the current workbench scope', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowSteering, {
          workflowId: 'workflow-1',
          workflowName: 'Workflow 1',
          workflowState: 'active',
          boardColumns: [{ id: 'active', label: 'Active', is_terminal: false }],
          selectedWorkItemId: 'work-item-7',
          selectedWorkItemTitle: 'Prepare release bundle',
          selectedWorkItem: createWorkItem(),
          selectedTaskId: 'task-3',
          selectedTaskTitle: 'Verify deliverable',
          selectedTask: createTask(),
          selectedWorkItemTasks: [createTask()],
          scope: {
            scopeKind: 'selected_task',
            title: 'Task',
            subject: 'task',
            name: 'Verify deliverable',
            banner: 'Task: Verify deliverable',
          },
          interventions: [],
          messages: [],
          sessionId: null,
          canAcceptRequest: true,
        }),
      ),
    );

    expect(html).toContain('Task: Verify deliverable');
    expect(html).toContain('Record durable requests, responses, and attachments for this task.');
    expect(html).toContain('Guide Verify deliverable toward the next legal action.');
    expect(html).toContain('Targeting task: Verify deliverable');
    expect(html).toContain('No steering history exists for this task yet.');
  });

  it('requires an explicit target choice before workflow-scoped steering can be submitted', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(WorkflowSteering, {
          workflowId: 'workflow-1',
          workflowName: 'Workflow 1',
          workflowState: 'active',
          boardColumns: [{ id: 'active', label: 'Active', is_terminal: false }],
          selectedWorkItemId: null,
          selectedWorkItemTitle: null,
          selectedWorkItem: null,
          selectedTaskId: null,
          selectedTaskTitle: null,
          selectedTask: null,
          selectedWorkItemTasks: [],
          scope: {
            scopeKind: 'workflow',
            title: 'Workflow',
            subject: 'workflow',
            name: 'Workflow 1',
            banner: 'Workflow: Workflow 1',
          },
          interventions: [],
          messages: [],
          sessionId: null,
          canAcceptRequest: true,
        }),
      ),
    );

    expect(html).toContain('Steering target');
    expect(html).toContain('Choose a steering target before recording a request.');
    expect(html).toContain('Select a target');
  });

  it('builds task-targeted steering requests with the task id in the payload', () => {
    const target = buildWorkflowSteeringTargets({
      workflowName: 'Workflow 1',
      workflowState: 'active',
      boardColumns: [{ id: 'active', label: 'Active', is_terminal: false }],
      scope: {
        scopeKind: 'selected_task',
        title: 'Task',
        subject: 'task',
        name: 'Verify deliverable',
        banner: 'Task: Verify deliverable',
      },
      selectedWorkItemId: 'work-item-7',
      selectedWorkItemTitle: 'Prepare release bundle',
      selectedWorkItem: createWorkItem(),
      selectedTaskId: 'task-3',
      selectedTaskTitle: 'Verify deliverable',
      selectedTask: createTask(),
      selectedWorkItemTasks: [createTask()],
    })[0];

    expect(
      buildWorkflowSteeringRequestInput({
        requestId: 'request-1',
        request: 'Tighten the approval brief.',
        sessionId: 'session-1',
        target,
      }),
    ).toEqual({
      request_id: 'request-1',
      request: 'Tighten the approval brief.',
      work_item_id: 'work-item-7',
      task_id: 'task-3',
      linked_input_packet_ids: [],
      session_id: 'session-1',
    });
  });

  it('excludes paused and terminal narrower targets from the workflow target picker', () => {
    const options = buildWorkflowSteeringTargets({
      workflowName: 'Workflow 1',
      workflowState: 'active',
      boardColumns: [{ id: 'done', label: 'Done', is_terminal: true }],
      scope: {
        scopeKind: 'workflow',
        title: 'Workflow',
        subject: 'workflow',
        name: 'Workflow 1',
        banner: 'Workflow: Workflow 1',
      },
      selectedWorkItemId: 'work-item-7',
      selectedWorkItemTitle: 'Prepare release bundle',
      selectedWorkItem: createWorkItem({ completed_at: '2026-03-28T04:00:00.000Z' }),
      selectedTaskId: 'task-3',
      selectedTaskTitle: 'Verify deliverable',
      selectedTask: createTask({ state: 'paused' as unknown as DashboardTaskRecord['state'] }),
      selectedWorkItemTasks: [createTask({ state: 'paused' as unknown as DashboardTaskRecord['state'] })],
    });

    expect(options.map((option) => option.label)).toEqual(['Workflow: Workflow 1']);
  });

  it('reports a clear disabled reason when the selected task is paused', () => {
    const target = buildWorkflowSteeringTargets({
      workflowName: 'Workflow 1',
      workflowState: 'active',
      boardColumns: [{ id: 'active', label: 'Active', is_terminal: false }],
      scope: {
        scopeKind: 'selected_task',
        title: 'Task',
        subject: 'task',
        name: 'Verify deliverable',
        banner: 'Task: Verify deliverable',
      },
      selectedWorkItemId: 'work-item-7',
      selectedWorkItemTitle: 'Prepare release bundle',
      selectedWorkItem: createWorkItem(),
      selectedTaskId: 'task-3',
      selectedTaskTitle: 'Verify deliverable',
      selectedTask: createTask({ state: 'paused' as unknown as DashboardTaskRecord['state'] }),
      selectedWorkItemTasks: [createTask({ state: 'paused' as unknown as DashboardTaskRecord['state'] })],
    })[0];

    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'active',
        boardColumns: [{ id: 'active', label: 'Active', is_terminal: false }],
        target,
        selectedWorkItem: createWorkItem(),
        selectedTask: createTask({ state: 'paused' as unknown as DashboardTaskRecord['state'] }),
        selectedWorkItemTasks: [createTask({ state: 'paused' as unknown as DashboardTaskRecord['state'] })],
      }),
    ).toBe('This task is paused. Resume it or choose another target before steering.');
  });
});

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
    workflow: {
      id: 'workflow-1',
      name: 'Workflow 1',
      workspace_id: 'workspace-1',
    },
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
