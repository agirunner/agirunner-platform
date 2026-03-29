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
    expect(items[0]!.headline).toBe('[Plan] Route the approved intake item to policy assessment.');
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

  it('suppresses planning text that only talks about recording briefs and submitting required handoffs', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '21ca',
        operation: 'agent.plan',
        payload: {
          plan_summary:
            'Record the closure milestone for operators, then submit the required structured handoff to finish this orchestrator activation.',
        },
      }),
      createLogRow({
        id: '21cb',
        operation: 'agent.plan',
        payload: {
          plan_summary:
            'Emit the required milestone operator brief for the completed intake-item closure checkpoint, then reassess completion.',
        },
      }),
      createLogRow({
        id: '21cc',
        operation: 'agent.plan',
        payload: {
          plan_summary:
            'Finish this heartbeat activation by submitting the required structured handoff now that the stale wait state has been corrected and the new policy assessment task is active.',
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
      '[Act] Submitting the handoff: Triage packet is ready for policy assessment.',
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
      '[Act] Submitting the handoff: Triage packet is ready for policy assessment.',
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

  it('suppresses low-value helper reads instead of surfacing empty tool-call fallbacks', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22cc',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          text_preview: 'calling file_read()',
          input: {
            path: '/tmp/workspace/task-4df24677-e56d-42e5-9c75-d86e9d8c01cf/context/task-input.json',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses low-value list helpers even when they expose operator-safe args', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22ccd',
        operation: 'agent.act',
        payload: {
          tool: 'artifact_list',
          input: {
            limit: 20,
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses low-value task-status reads and lets observe/plan rows carry the wait state', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22cce',
        operation: 'agent.act',
        payload: {
          tool: 'read_task_status',
          input: {
            task_id: 'task-1',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses read-only workflow continuity helpers instead of surfacing tool syntax', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22ccf',
        operation: 'agent.act',
        payload: {
          tool: 'read_work_item_continuity',
          input: {
            work_item_id: 'work-item-1',
          },
        },
      }),
      createLogRow({
        id: '22ccg',
        operation: 'agent.act',
        payload: {
          tool: 'read_latest_handoff',
          input: {
            work_item_id: 'work-item-1',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses empty action calls when the tool payload carries no operator-meaningful args', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22ca',
        operation: 'agent.act',
        payload: {
          tool: 'submit_handoff',
          input: {},
        },
      }),
      createLogRow({
        id: '22cb',
        operation: 'agent.act',
        payload: {
          tool: 'shell_exec',
          input: {},
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses file reads even when a safe path-range summary can be derived', () => {
    const items = buildExecutionTurnItems([
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

    expect(items).toEqual([]);
  });

  it('suppresses file reads when the only path is a temp workspace context path', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22da',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          input: {
            path: '/tmp/workspace/task-4df24677-e56d-42e5-9c75-d86e9d8c01cf/context/current-task.md',
            offset: 1,
            limit: 200,
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('humanizes artifact uploads instead of exposing raw tool syntax', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22db',
        operation: 'agent.act',
        payload: {
          tool: 'artifact_upload',
          input: {
            path: '/tmp/workspace/task-4df24677-e56d-42e5-9c75-d86e9d8c01cf/output/release-packet.md',
            logical_path: 'output/release-packet.md',
            artifact_id: 'artifact-1',
          },
        },
      }),
    ]);

    expect(item.headline).toBe('[Act] Uploading output/release-packet.md.');
  });

  it('suppresses action fallbacks when only temp-path and id args are present', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22dc',
        operation: 'agent.act',
        payload: {
          tool: 'shell_exec',
          input: {
            cwd: '/tmp/workspace/task-4df24677-e56d-42e5-9c75-d86e9d8c01cf',
            request_id: 'req-1',
            task_id: 'task-1',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('keeps operator-meaningful safe args while dropping temp context paths and noise', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22dd',
        operation: 'agent.act',
        payload: {
          tool: 'submit_handoff',
          input: {
            summary: 'Completed the intake-triage deliverable for workflows-intake-01.',
            successor_context:
              'Current subject state is documented in the uploaded triage packet. The assessor can continue from the packet.',
            context_path: '/tmp/workspace/task-4df24677-e56d-42e5-9c75-d86e9d8c01cf/context/current-task.md',
            request_id: 'handoff-1',
            work_item_id: 'work-item-1',
          },
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Submitting the handoff: Completed the intake-triage deliverable for workflows-intake-01.',
    );
    expect(item.headline).not.toContain('/tmp/workspace/');
    expect(item.headline).not.toContain('context/current-task.md');
  });

  it('adds normalized phase labels for think, observe, and meaningful verify rows', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '26',
        operation: 'agent.think',
        payload: {
          reasoning_summary: 'Check whether the existing intake item already has unresolved findings.',
        },
      }),
      createLogRow({
        id: '27',
        operation: 'agent.observe',
        payload: {
          summary: 'The policy-assessor task is already in progress for workflows-intake-01.',
        },
      }),
      createLogRow({
        id: '28',
        operation: 'agent.verify',
        payload: {
          status: 'blocked',
          summary: 'The handoff is blocked until the required target URL is available.',
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Think] Check whether the existing intake item already has unresolved findings.',
      '[Observe] The policy-assessor task is already in progress for workflows-intake-01.',
      '[Verify] The handoff is blocked until the required target URL is available.',
    ]);
  });

  it('falls back to calling syntax only when a meaningful action cannot be humanized', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '29',
        operation: 'agent.act',
        payload: {
          tool: 'shell_exec',
          input: {
            command: 'pytest tests/unit',
          },
        },
      }),
    ]);

    expect(item.headline).toBe('[Act] calling shell_exec(command="pytest tests/unit")');
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

  it('suppresses runtime budget markers that are not useful operator-facing updates', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '25',
        operation: 'agent.observe',
        payload: {
          text_preview: 'burst_budget:max_tool_steps',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('normalizes prefixed reasoning text and strips stray unicode markers', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '30',
        operation: 'agent.think',
        payload: {
          approach: 'approach: • Check whether the policy review task is already active.\u200b',
        },
      }),
    ]);

    expect(item.headline).toBe('[Think] Check whether the policy review task is already active.');
    expect(item.summary).toBe('Check whether the policy review task is already active.');
  });

  it('suppresses helper-read act rows even when they narrate the read in plain text', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '31',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          headline: 'Read the task input packet before deciding the next step.',
          input: {
            path: 'context/task-input.json',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('keeps brief-style operator updates visible after normalization', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '32',
        operation: 'agent.observe',
        payload: {
          summary: 'Operator brief: Policy review is ready for operator approval.',
        },
      }),
    ]);

    expect(item.headline).toBe('[Observe] Policy review is ready for operator approval.');
    expect(item.summary).toBe('Policy review is ready for operator approval.');
  });

  it('suppresses adjacent normalized rows when they repeat the same state with no new detail', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '33',
        operation: 'agent.observe',
        payload: {
          summary: 'Policy review is waiting on operator approval.',
        },
      }),
      createLogRow({
        id: '34',
        operation: 'agent.verify',
        payload: {
          status: 'waiting',
          summary: 'Policy review is waiting on operator approval.',
        },
      }),
    ]);

    expect(items.map((item) => item.item_id)).toEqual(['execution-log:33']);
  });

  it('keeps distinct think and plan rows even when they share the same operator-facing summary', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '35',
        operation: 'agent.think',
        payload: {
          reasoning_summary: 'Route the approved intake item to policy assessment.',
        },
      }),
      createLogRow({
        id: '36',
        operation: 'agent.plan',
        payload: {
          plan_summary: 'Route the approved intake item to policy assessment.',
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Think] Route the approved intake item to policy assessment.',
      '[Plan] Route the approved intake item to policy assessment.',
    ]);
  });

  it('coalesces short same-phase bursts into a single normalized line', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '37',
        operation: 'agent.plan',
        payload: {
          plan_summary: 'Check whether the previous policy findings are still unresolved.',
        },
      }),
      createLogRow({
        id: '38',
        operation: 'agent.plan',
        payload: {
          plan_summary: 'If they are, send the packet back for rework instead of routing it forward.',
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Plan] Check whether the previous policy findings are still unresolved. If they are, send the packet back for rework instead of routing it forward.',
    );
    expect(item.summary).toBe(
      'Check whether the previous policy findings are still unresolved. If they are, send the packet back for rework instead of routing it forward.',
    );
  });

  it('prefers a humanized action summary over raw tool syntax when both are present', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '39',
        operation: 'agent.act',
        payload: {
          tool: 'artifact_upload',
          text_preview: 'artifact_upload(path="output/release-packet.md")',
          input: {
            logical_path: 'output/release-packet.md',
          },
        },
      }),
    ]);

    expect(item.headline).toBe('[Act] Uploading output/release-packet.md.');
    expect(item.summary).toBe('Uploading output/release-packet.md.');
  });

  it('builds think, plan, and verify rows from llm chat stream responses', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '40',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'think',
          response_text: JSON.stringify({
            approach: 'Check whether the latest approval is already persisted.',
          }),
        },
      }),
      createLogRow({
        id: '41',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'plan',
          response_text: JSON.stringify({
            summary: 'Route the approved intake item to policy assessment.',
          }),
        },
      }),
      createLogRow({
        id: '42',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'verify',
          response_text: JSON.stringify({
            decision: 'continue',
            reason: 'The policy assessment is still waiting on approval.',
          }),
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Think] Check whether the latest approval is already persisted.',
      '[Plan] Route the approved intake item to policy assessment.',
      '[Verify] The policy assessment is still waiting on approval.',
    ]);
  });

  it('falls back to logged tool calls for llm act turns when no usable prose exists', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '43',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'submit_handoff',
              input: {
                summary: 'Triage packet is ready for policy assessment.',
                completion: 'full',
              },
            },
          ],
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Submitting the handoff: Triage packet is ready for policy assessment.',
    );
  });

  it('suppresses llm act turns when they only call low-value helper reads', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'act',
          response_text: 'calling file_read()',
          response_tool_calls: [
            {
              name: 'file_read',
              input: {
                path: '/tmp/workspace/task-1/context/task-input.json',
              },
            },
          ],
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('derives llm execution-turn scope from structured tool-call targets', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '45',
        category: 'llm',
        operation: 'llm.chat_stream',
        work_item_id: null,
        task_id: null,
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'create_task',
              input: {
                target_type: 'work_item',
                target_id: 'work-item-9',
                task_id: 'task-44',
                title: 'Assess the triage packet',
              },
            },
          ],
        },
      }),
    ]);

    expect(item.work_item_id).toBe('work-item-9');
    expect(item.task_id).toBe('task-44');
    expect(item.scope_binding).toBe('structured_target');
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
