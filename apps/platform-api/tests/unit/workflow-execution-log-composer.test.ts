import { describe, expect, it } from 'vitest';

import {
  buildExecutionTurnItems,
  buildLifecycleHistoryItems,
} from '../../src/services/workflow-operations/workflow-execution-log-composer.js';

describe('workflow-execution-log-composer', () => {
  it('carries explicit work-item and task ids into execution turn items', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '11',
        operation: 'agent.act',
        role: 'policy-assessor',
        actor_name: 'Policy Assessor',
        work_item_id: 'work-item-7',
        task_id: 'task-4',
        payload: {
          tool: 'create_task',
          input: {
            role: 'policy-assessor',
          },
        },
      }),
    ]);

    expect(item).toEqual(
      expect.objectContaining({
        item_id: 'execution-log:11',
        work_item_id: 'work-item-7',
        task_id: 'task-4',
      }),
    );
  });

  it('carries explicit work-item and task ids into lifecycle history items', () => {
    const [item] = buildLifecycleHistoryItems([
      createLogRow({
        id: '12',
        operation: 'task_lifecycle.task.completed',
        role: 'policy-assessor',
        actor_name: 'Policy Assessor',
        work_item_id: 'work-item-7',
        task_id: 'task-4',
      }),
    ]);

    expect(item).toEqual(
      expect.objectContaining({
        item_id: 'lifecycle-log:12',
        work_item_id: 'work-item-7',
        task_id: 'task-4',
      }),
    );
  });

  it('uses plan summaries and suppresses generic observe execution dumps', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '20',
        operation: 'agent.plan',
        payload: {
          plan_summary: 'Route the approved intake item to policy assessment.',
        },
      }),
      createLogRow({
        id: '21',
        operation: 'agent.observe',
        payload: {
          text_preview: 'executed 2 tools (2 succeeded, 0 failed): list_workflow_tasks, list_workflow_tasks',
        },
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]!.headline).toBe('Route the approved intake item to policy assessment.');
  });

  it('suppresses observe turns that only report internal operator mutations', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '21a',
        operation: 'agent.observe',
        payload: {
          signal_tools: ['record_operator_brief', 'submit_handoff'],
          text_preview: 'executed 2 tools (2 succeeded, 0 failed): record_operator_brief, submit_handoff',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses observe turns that only report boundary tool markers', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '21aa',
        operation: 'agent.observe',
        payload: {
          text_preview: 'boundary_tool:artifact_upload',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses generic verify rows when they do not carry operator-meaningful text', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '21b',
        operation: 'agent.verify',
        payload: {
          status: 'complete',
          decision: 'continue',
          llm_turn_count: 3,
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses planning text that only narrates internal operator-record bookkeeping', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '21c',
        operation: 'agent.plan',
        payload: {
          plan_summary:
            'Emit the required milestone operator brief now that routing and handoff are complete for this activation.',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('formats act turns as action calls with safe args', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22',
        operation: 'agent.act',
        payload: {
          tool: 'submit_handoff',
          input: {
            summary: 'Triage packet is ready for policy assessment.',
            completion: 'full',
            work_item_id: '71a51fdc-f359-4fd9-b5d6-6df414d128f2',
            request_id: 'handoff-1',
            changes: ['Prepared summary', 'Prepared next action'],
          },
        },
      }),
    ]);

    expect(item.headline).toBe(
      'calling submit_handoff(summary="Triage packet is ready for policy assessment.", completion="full")',
    );
  });

  it('prefers the action-call headline when act text is generic filler', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22a',
        operation: 'agent.act',
        payload: {
          tool: 'submit_handoff',
          text_preview: 'Advancing the task with the next verified step.',
          input: {
            summary: 'Triage packet is ready for policy assessment.',
            completion: 'full',
          },
        },
      }),
    ]);

    expect(item.headline).toBe(
      'calling submit_handoff(summary="Triage packet is ready for policy assessment.", completion="full")',
    );
  });

  it('suppresses repetitive same-state readiness narration', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22b',
        operation: 'agent.observe',
        payload: {
          text_preview: 'Intake triage remains ready for policy assessment.',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses empty helper action calls with no meaningful args', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22c',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          input: {},
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('formats file reads using the path-range summary style from the log viewer', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22d',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          input: {
            path: 'output/workflows-intake-01-triage-packet.md',
            offset: 1,
            limit: 200,
          },
        },
      }),
    ]);

    expect(item.headline).toBe(
      'calling file_read(path="output/workflows-intake-01-triage-packet.md:1-200")',
    );
  });

  it('suppresses internal operator-recording act turns so the live console shows only the resulting record', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '23',
        operation: 'agent.act',
        payload: {
          tool: 'record_operator_update',
          text_preview:
            'to=record_operator_update json {"request_id":"operator-update-1","payload":{"headline":"raw leak"}}',
          input: {
            request_id: 'operator-update-1',
            payload: {
              headline: 'The workflow is waiting on approval.',
            },
          },
        },
      }),
      createLogRow({
        id: '24',
        operation: 'agent.act',
        payload: {
          tool: 'record_operator_brief',
          input: {
            payload: {
              short_brief: {
                headline: 'Policy review is ready for operator approval.',
              },
            },
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });
});

function createLogRow(
  patch: Partial<Parameters<typeof buildExecutionTurnItems>[0][number]> = {},
): Parameters<typeof buildExecutionTurnItems>[0][number] {
  return {
    id: '10',
    tenant_id: 'tenant-1',
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    source: 'runtime',
    category: 'agent_loop',
    level: 'info',
    operation: 'agent.observe',
    status: 'completed',
    duration_ms: 12,
    payload: {},
    error: null,
    workspace_id: 'workspace-1',
    workflow_id: 'workflow-1',
    workflow_name: 'Workflow 1',
    workspace_name: 'Workspace 1',
    task_id: null,
    work_item_id: null,
    stage_name: null,
    activation_id: 'activation-1',
    is_orchestrator_task: false,
    execution_backend: 'runtime_plus_task',
    tool_owner: 'task',
    task_title: 'Assess intake packet',
    role: 'specialist',
    actor_type: 'runtime',
    actor_id: 'runtime',
    actor_name: 'Verifier',
    resource_type: null,
    resource_id: null,
    resource_name: null,
    execution_environment_id: null,
    execution_environment_name: null,
    execution_environment_image: null,
    execution_environment_distro: null,
    execution_environment_package_manager: null,
    created_at: '2026-03-28T10:00:00.000Z',
    ...patch,
  };
}
