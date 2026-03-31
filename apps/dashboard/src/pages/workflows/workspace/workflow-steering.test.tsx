import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
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
    expect(html).not.toContain('Steering history');
    expect(html).not.toContain('No steering history exists');
    expect(html).not.toContain('Steering target');
    expect(html).not.toContain('Target kind');
    expect(html).not.toContain('Specific work item');
    expect(html).not.toContain('Choose a steering target');
  });

  it('keeps the composer work-item-scoped even when the surrounding page state is already narrowed', () => {
    const html = renderSteering();

    expect(html).toContain('Guide Prepare release bundle toward the next legal action.');
    expect(html).toContain('Operator guidance');
    expect(html).toContain('Work item · Prepare release bundle');
    expect(html).not.toContain('Task: Verify deliverable');
    expect(html).not.toContain('Workflow: Workflow 1');
  });

  it('shows a clear disabled message instead of offering workflow-level steering when no work item is selected', () => {
    const html = renderSteering({
      selectedWorkItemId: null,
      selectedWorkItemTitle: null,
      selectedWorkItem: null,
      scope: createScope('workflow'),
    });

    expect(html).toContain('Steering is unavailable for this workflow.');
    expect(html).toContain('Select a work item before steering.');
    expect(html).not.toContain('Operator guidance');
    expect(html).not.toContain('Guide Workflow 1 toward the next legal action.');
    expect(html).not.toContain('Record steering request');
  });

  it('offers only the selected work item as a steering target even when rendered from workflow scope', () => {
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        scope: createScope('workflow'),
      }),
    );

    expect(options.map((option) => option.label)).toEqual(['Work item: Prepare release bundle']);
  });

  it('builds work-item-targeted steering requests with the work item id in the payload', () => {
    expect(
      createRequestPayload(createTarget('selected_work_item')),
    ).toEqual({
      request_id: 'request-1',
      request: 'Keep the rollout limited to the current scope.',
      work_item_id: 'work-item-7',
      task_id: undefined,
      linked_input_packet_ids: [],
      session_id: 'session-1',
    });
  });

  it('excludes paused and terminal narrower work-item targets from steering entirely', () => {
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        boardColumns: doneColumns(),
        scope: createScope('workflow'),
        selectedWorkItem: createWorkItem({ completed_at: '2026-03-28T04:00:00.000Z' }),
      }),
    );
    expect(options).toEqual([]);
  });

  it('excludes cancelled narrower targets from the workflow target picker', () => {
    const options = buildWorkflowSteeringTargets(
      createTargetContext({
        workflowState: 'cancelled',
        boardColumns: activeColumns(),
        scope: createScope('workflow'),
      }),
    );

    expect(options.map((option) => option.label)).toEqual([]);
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
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'active',
        boardColumns: doneColumns(),
        target,
        selectedWorkItem: completedWorkItem,
      }),
    ).toBe('This work item is already completed or cancelled. Historical work cannot be steered.');
  });

  it('reports a clear disabled reason when stale task scope belongs to a cancelled workflow', () => {
    const target = createTarget('selected_work_item', {
      workflowState: 'cancelled',
    });
    expect(
      describeSteeringTargetDisabledReason({
        workflowState: 'cancelled',
        boardColumns: activeColumns(),
        target,
        selectedWorkItem: createWorkItem(),
      }),
    ).toBe('This workflow is cancelled. Historical work cannot be steered.');
  });

  it('shows the specific paused work-item reason and removes steering controls for paused scoped work', () => {
    const html = renderSteering({
      workflowState: 'paused',
      scope: createScope('selected_work_item'),
    });

    expect(html).toContain('This work item is paused. Resume it or choose another target before steering.');
    expect(html).not.toContain('Steering requests are unavailable for this workflow right now.');
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
      canAcceptRequest: false,
    });

    expect(html).toContain('Select a work item before steering.');
    expect(html).not.toContain('Operator guidance');
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

    expect(html).not.toContain('Steering request');
    expect(html).not.toContain('Tighten the approval brief.');
    expect(html).not.toContain('Open session');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-background/80 p-4');
    expect(html).not.toContain('rounded-2xl border border-border/70 bg-muted/10 p-4');
    expect(html).not.toContain('Steering history');
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
  return {
    workflowId: 'workflow-1',
    workflowName: 'Workflow 1',
    workflowState: 'active',
    boardColumns: activeColumns(),
    selectedWorkItemId: 'work-item-7',
    selectedWorkItemTitle: 'Prepare release bundle',
    selectedWorkItem: createWorkItem(),
    scope: createScope('selected_work_item'),
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
  return {
    workflowName: 'Workflow 1',
    workflowState: 'active',
    boardColumns: activeColumns(),
    scope: createScope('selected_work_item'),
    selectedWorkItemId: 'work-item-7',
    selectedWorkItemTitle: 'Prepare release bundle',
    selectedWorkItem: createWorkItem(),
    ...overrides,
  };
}

function createRequestPayload(target = createTarget('selected_work_item')) {
  return buildWorkflowSteeringRequestInput({
    requestId: 'request-1',
    request: 'Keep the rollout limited to the current scope.',
    sessionId: 'session-1',
    target,
  });
}

function createScope(scopeKind: WorkflowSteeringTargetContext['scope']['scopeKind']) {
  if (scopeKind === 'workflow') {
    return {
      scopeKind,
      title: 'Workflow' as const,
      subject: 'workflow' as const,
      name: 'Workflow 1',
      banner: 'Workflow: Workflow 1',
    };
  }
  return {
    scopeKind: 'selected_work_item' as const,
    title: 'Work item' as const,
    subject: 'work item' as const,
    name: 'Prepare release bundle',
    banner: 'Work item: Prepare release bundle',
  };
}

function activeColumns() {
  return [{ id: 'active', label: 'Active', is_terminal: false }];
}
function doneColumns() {
  return [{ id: 'done', label: 'Done', is_terminal: true }];
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
