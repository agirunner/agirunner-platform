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

  it('surfaces runtime loop think and plan rows when agent think and plan rows are absent', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '26a',
        operation: 'runtime.loop.think',
        payload: {
          phase: 'think',
          llm_turn_count: 4,
          reasoning_summary: 'Check whether the release-audit baseline already passed review.',
        },
      }),
      createLogRow({
        id: '26b',
        operation: 'runtime.loop.plan',
        payload: {
          phase: 'plan',
          llm_turn_count: 4,
          steps: [
            {
              description: 'Read the current release-audit packet and verify its baseline fields.',
            },
          ],
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Think] Check whether the release-audit baseline already passed review.',
      '[Plan] Read the current release-audit packet and verify its baseline fields.',
    ]);
  });

  it('prefers runtime loop observe and verify rows over generic mirrored agent rows for the same turn', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '26c',
        operation: 'agent.observe',
        activation_id: 'activation-1',
        role: 'mixed-security-assessor',
        task_id: 'task-1',
        work_item_id: 'work-item-1',
        payload: {
          burst_id: 3,
          text_preview: 'tool_failure',
        },
      }),
      createLogRow({
        id: '26d',
        operation: 'runtime.loop.observe',
        activation_id: 'activation-1',
        role: 'mixed-security-assessor',
        task_id: 'task-1',
        work_item_id: 'work-item-1',
        payload: {
          burst_id: 3,
          summary: 'Reviewed the current release-audit packet and found no unresolved security blockers.',
        },
      }),
      createLogRow({
        id: '26e',
        operation: 'agent.verify',
        activation_id: 'activation-1',
        role: 'mixed-security-assessor',
        task_id: 'task-1',
        work_item_id: 'work-item-1',
        payload: {
          burst_id: 3,
          status: 'continue',
          summary: 'continue',
        },
      }),
      createLogRow({
        id: '26f',
        operation: 'runtime.loop.verify',
        activation_id: 'activation-1',
        role: 'mixed-security-assessor',
        task_id: 'task-1',
        work_item_id: 'work-item-1',
        payload: {
          burst_id: 3,
          status: 'complete',
          details: 'Security review is complete and ready for handoff.',
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Observe] Reviewed the current release-audit packet and found no unresolved security blockers.',
      '[Verify] Security review is complete and ready for handoff.',
    ]);
    expect(items.map((item) => item.item_id)).not.toContain('execution-log:26c');
    expect(items.map((item) => item.item_id)).not.toContain('execution-log:26e');
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

  it('renders literal shell_exec act turns from llm chat stream tool calls when no prose exists', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '29a',
        operation: 'llm.chat_stream',
        status: 'completed',
        payload: {
          phase: 'act',
          llm_turn_count: 2,
          response_tool_calls: [
            {
              name: 'shell_exec',
              input: {
                command: 'apt-get update && apt-get install -y python3',
              },
            },
            {
              name: 'shell_exec',
              input: {
                command: './scripts/verify.sh',
              },
            },
          ],
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Act] Installing Python 3 in the task environment; running the verification script.',
    ]);
  });

  it('suppresses low-value shell_exec environment checks from llm chat stream tool calls', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '29b',
        operation: 'llm.chat_stream',
        status: 'completed',
        payload: {
          phase: 'act',
          llm_turn_count: 3,
          response_tool_calls: [
            {
              name: 'shell_exec',
              input: {
                command: 'bash --version >/tmp/bash_version.txt 2>&1 && python3 --version >/tmp/python_version.txt 2>&1',
              },
            },
          ],
        },
      }),
    ]);

    expect(items).toEqual([]);
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

  it('suppresses tool execution in progress observe rows', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '25a',
        operation: 'agent.observe',
        payload: {
          text_preview: 'tool execution in progress',
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

  it('suppresses prefixed synthetic helper tool-call wrappers leaked through llm chat stream text', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '31a',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'completed',
        payload: {
          phase: 'act',
          response_text: JSON.stringify({
            headline: 'Policy Assessor: calling file_read()',
          }),
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses prefixed raw operator-update scaffolding leaked through llm chat stream text', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '31b',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'completed',
        payload: {
          phase: 'act',
          response_text: JSON.stringify({
            headline:
              'Orchestrator: to=record_operator_update json {"request_id":"operator-update-1","payload":{"headline":"raw leak"}}',
          }),
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('produces the same meaningful enhanced turn rows regardless of input log order', () => {
    const rows = [
      createLogRow({
        id: '31c-1',
        operation: 'runtime.loop.think',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.001Z',
        payload: {
          phase: 'think',
          reasoning_summary:
            'I have the new blueprint work item id, so I will now create the solution architect task with repository execution context and then finish the activation with the required milestone brief and structured handoff.',
        },
      }),
      createLogRow({
        id: '31c-2',
        operation: 'runtime.loop.plan',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.002Z',
        payload: {
          phase: 'plan',
          summary:
            'Dispatch the solution architect on the new blueprint work item so the stage can begin producing the required technical direction.',
          steps: [
            {
              tool: 'create_task',
              input: {
                role: 'approve-solution-architect',
                work_item_id: 'work-item-1',
                request_id: 'task-create-r1',
              },
            },
          ],
        },
      }),
      createLogRow({
        id: '31c-3',
        operation: 'runtime.loop.act',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.003Z',
        payload: {
          phase: 'act',
          tool_count: 1,
        },
      }),
      createLogRow({
        id: '31c-4',
        operation: 'runtime.loop.observe',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.004Z',
        payload: {
          phase: 'observe',
          summary:
            'executed 1 tools (0 succeeded, 1 failed): create_task. errors: create_task: platform api POST failed with status 422 (SCHEMA...)',
        },
      }),
      createLogRow({
        id: '31c-5',
        operation: 'runtime.loop.verify',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.005Z',
        payload: {
          phase: 'verify',
          status: 'continue',
          details:
            'The task is not blocked permanently; the failed create_task call is recoverable because the platform explicitly rejected an unsupported field, so the next iteration should retry with a schema-valid payload.',
        },
      }),
      createLogRow({
        id: '31c-6',
        operation: 'runtime.loop.think',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.006Z',
        payload: {
          phase: 'think',
          reasoning_summary:
            'I will retry the solution architect task creation with only schema-supported fields, then finish this activation with the required milestone brief and structured handoff if the dispatch succeeds.',
        },
      }),
      createLogRow({
        id: '31c-7',
        operation: 'runtime.loop.plan',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.007Z',
        payload: {
          phase: 'plan',
          summary:
            'Retry the blueprint dispatch with a schema-valid task payload so the solution architect can start work on the new blueprint item.',
          steps: [
            {
              tool: 'create_task',
              input: {
                role: 'approve-solution-architect',
                work_item_id: 'work-item-1',
                request_id: 'task-create-r2',
              },
            },
          ],
        },
      }),
      createLogRow({
        id: '31c-8',
        operation: 'runtime.loop.plan',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:00.008Z',
        payload: {
          phase: 'plan',
          summary:
            'Close this activation cleanly by recording the blueprint dispatch milestone and submitting the structured handoff that leaves the workflow waiting on the solution architect task.',
          steps: [
            {
              tool: 'record_operator_brief',
              input: {
                request_id: 'brief-r1',
              },
            },
            {
              tool: 'submit_handoff',
              input: {
                request_id: 'handoff-r1',
              },
            },
          ],
        },
      }),
    ];

    const ascending = buildExecutionTurnItems(rows);
    const descending = buildExecutionTurnItems([...rows].reverse());

    expect(descending).toEqual(ascending);
    expect(ascending.map((item) => item.item_id)).toEqual([
      'execution-log:31c-1',
      'execution-log:31c-2',
      'execution-log:31c-5',
      'execution-log:31c-7',
    ]);
    expect(ascending[3]?.headline).toContain(
      'Retry the blueprint dispatch with a schema-valid task payload',
    );
    expect(ascending[3]?.headline).toContain(
      'Close this activation cleanly',
    );
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

  it('prefers llm think, plan, and verify rows over mirrored agent-loop rows for the same turn', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '40a',
        operation: 'agent.think',
        payload: {
          reasoning_summary: 'Check whether the latest approval is already persisted.',
          llm_turn_count: 17,
        },
      }),
      createLogRow({
        id: '40b',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'think',
          llm_turn_count: 17,
          response_text: JSON.stringify({
            approach: 'Check whether the latest approval is already persisted.',
          }),
        },
      }),
      createLogRow({
        id: '41a',
        operation: 'agent.plan',
        payload: {
          plan_summary: 'Route the approved intake item to policy assessment.',
          llm_turn_count: 18,
        },
      }),
      createLogRow({
        id: '41b',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'plan',
          llm_turn_count: 18,
          response_text: JSON.stringify({
            summary: 'Route the approved intake item to policy assessment.',
          }),
        },
      }),
      createLogRow({
        id: '42a',
        operation: 'agent.verify',
        payload: {
          status: 'waiting',
          summary: 'The policy assessment is still waiting on approval.',
          llm_turn_count: 19,
        },
      }),
      createLogRow({
        id: '42b',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'verify',
          llm_turn_count: 19,
          response_text: JSON.stringify({
            decision: 'continue',
            reason: 'The policy assessment is still waiting on approval.',
          }),
        },
      }),
    ]);

    expect(items.map((item) => item.item_id)).toEqual([
      'execution-log:40b',
      'execution-log:41b',
      'execution-log:42b',
    ]);
  });

  it('humanizes logged tool calls for llm act turns when no usable prose exists', () => {
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

  it('sanitizes uuid-heavy handoff summaries so act rows stay human-readable', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '43c',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'submit_handoff',
              input: {
                summary:
                  'The delivery task 8d2ec505-f6de-44ee-817d-8caf129ac1b6 for work item 95b223b4-bfc7-46c7-8fee-ec61d8b93cad was rerouted and implementation can resume.',
                completion: 'full',
              },
            },
          ],
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Submitting the handoff: The delivery task for the work item was rerouted and implementation can resume.',
    );
    expect(item.summary).toBe(
      'Submitting the handoff: The delivery task for the work item was rerouted and implementation can resume.',
    );
  });

  it('humanizes request_rework act turns when no prose exists', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '43d',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'request_rework',
              input: {
                feedback:
                  'Resume implementation for the active revision after the replay conflict is cleared.',
              },
            },
          ],
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Requesting rework: Resume implementation for the active revision after the replay conflict is cleared.',
    );
  });

  it('suppresses low-value file_read helper turns even when safe args are available', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '43e',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'file_read',
              input: {
                path: '/tmp/workspace/task-123/context/task-input.json',
                offset: 1,
                limit: 80,
              },
            },
          ],
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses raw agent act rows when the same turn already has an llm act phase row', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '43a',
        operation: 'agent.act',
        payload: {
          tool: 'submit_handoff',
          llm_turn_count: 22,
          input: {
            summary: 'Triage packet is ready for policy assessment.',
            completion: 'full',
          },
        },
      }),
      createLogRow({
        id: '43b',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'act',
          llm_turn_count: 22,
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

    expect(items.map((item) => item.item_id)).toEqual(['execution-log:43b']);
  });

  it('suppresses synthetic runtime think placeholders that do not add operator value', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '43f',
        operation: 'runtime.loop.think',
        payload: {
          phase: 'think',
          reasoning_summary: 'Reactive native-tool turn',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('renders literal planned tool calls instead of execute-tool placeholders', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '43g',
        operation: 'runtime.loop.plan',
        payload: {
          phase: 'plan',
          steps: [
            {
              tool: 'submit_handoff',
              input: {
                summary: 'Release package needs revision before release-pass can close.',
                completion: 'full',
              },
              description: 'Execute submit_handoff',
            },
          ],
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Plan] Submitting the handoff: Release package needs revision before release-pass can close.',
    );
    expect(item.summary).toBe(
      'Submitting the handoff: Release package needs revision before release-pass can close.',
    );
  });

  it('humanizes llm tool-call fallbacks before resorting to literal calling syntax', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '43gb',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'completed',
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'submit_handoff',
              input: {
                summary: 'Implementation revision 3 is approved and ready for release-readiness routing.',
                completion: 'full',
              },
            },
          ],
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Submitting the handoff: Implementation revision 3 is approved and ready for release-readiness routing.',
    );
    expect(item.summary).toBe(
      'Submitting the handoff: Implementation revision 3 is approved and ready for release-readiness routing.',
    );
  });

  it('suppresses runtime plan placeholders when the only planned step is a low-value helper read', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '43ga',
        operation: 'runtime.loop.plan',
        payload: {
          phase: 'plan',
          steps: [
            {
              description: 'Execute artifact_read',
              tool: 'artifact_read',
              input: {
                artifact_id: 'artifact-1',
              },
            },
          ],
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('hydrates llm phase rows from separate response rows for the same turn', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '46a',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'started',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:01.000Z',
        payload: {
          phase: 'think',
          llm_turn_count: 5,
        },
      }),
      createLogRow({
        id: '46b',
        category: 'llm',
        operation: 'llm.chat_stream',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:02.000Z',
        payload: {
          llm_turn_count: 5,
          response_text: JSON.stringify({
            approach: 'Confirm whether the active design task already covers this work item.',
          }),
        },
      }),
      createLogRow({
        id: '47a',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'started',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:03.000Z',
        payload: {
          phase: 'plan',
          llm_turn_count: 6,
        },
      }),
      createLogRow({
        id: '47b',
        category: 'llm',
        operation: 'llm.chat_stream',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:04.000Z',
        payload: {
          llm_turn_count: 6,
          response_text: JSON.stringify({
            summary: 'Wait for the architecture lead handoff before routing implementation.',
          }),
        },
      }),
      createLogRow({
        id: '48a',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'started',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:05.000Z',
        payload: {
          phase: 'verify',
          llm_turn_count: 7,
        },
      }),
      createLogRow({
        id: '48b',
        category: 'llm',
        operation: 'llm.chat_stream',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:06.000Z',
        payload: {
          llm_turn_count: 7,
          response_text: JSON.stringify({
            reason: 'The design work is still waiting on the active architecture task.',
          }),
        },
      }),
    ]);

    expect(items.map((item) => item.headline)).toEqual([
      '[Think] Confirm whether the active design task already covers this work item.',
      '[Plan] Wait for the architecture lead handoff before routing implementation.',
      '[Verify] The design work is still waiting on the active architecture task.',
    ]);
    expect(items.map((item) => item.item_id)).toEqual([
      'execution-log:46a',
      'execution-log:47a',
      'execution-log:48a',
    ]);
  });

  it('hydrates llm act rows from separate response rows so human summaries win over raw tool syntax', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '49a',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'started',
        task_id: 'task-2',
        activation_id: 'activation-split-act',
        role: 'mixed-architecture-lead',
        created_at: '2026-03-28T10:01:01.000Z',
        payload: {
          phase: 'act',
          llm_turn_count: 4,
        },
      }),
      createLogRow({
        id: '49b',
        category: 'llm',
        operation: 'llm.chat_stream',
        task_id: 'task-2',
        activation_id: 'activation-split-act',
        role: 'mixed-architecture-lead',
        created_at: '2026-03-28T10:01:02.000Z',
        payload: {
          llm_turn_count: 4,
          response_text: JSON.stringify({
            summary: 'Draft the design packet and upload it for downstream implementation review.',
            steps: [
              {
                description: 'Write the design packet to the workspace output directory.',
                tool: 'file_write',
                input: {
                  path: '/tmp/workspace/task-2/output/design.md',
                },
              },
              {
                description: 'Upload the design packet artifact.',
                tool: 'artifact_upload',
                input: {
                  logical_path: 'output/design.md',
                },
              },
            ],
          }),
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Draft the design packet and upload it for downstream implementation review.',
    );
    expect(item.summary).toBe(
      'Draft the design packet and upload it for downstream implementation review.',
    );
  });

  it('parses duplicated concatenated json payloads from hydrated llm response rows', () => {
    const duplicatedPlan = JSON.stringify({
      summary:
        'Inspect the active implementation work item and its task continuity first so the next mutation targets the exact stale blocker instead of guessing.',
    });

    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '49c',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'started',
        task_id: 'task-3',
        activation_id: 'activation-duplicated-plan',
        role: 'orchestrator',
        created_at: '2026-03-28T10:02:01.000Z',
        payload: {
          phase: 'plan',
          llm_turn_count: 8,
        },
      }),
      createLogRow({
        id: '49d',
        category: 'llm',
        operation: 'llm.chat_stream',
        task_id: 'task-3',
        activation_id: 'activation-duplicated-plan',
        role: 'orchestrator',
        created_at: '2026-03-28T10:02:02.000Z',
        payload: {
          llm_turn_count: 8,
          response_text: `${duplicatedPlan}${duplicatedPlan}`,
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Plan] Inspect the active implementation work item and its task continuity first so the next mutation targets the exact stale blocker instead of guessing.',
    );
    expect(item.summary).toBe(
      'Inspect the active implementation work item and its task continuity first so the next mutation targets the exact stale blocker instead of guessing.',
    );
  });

  it('prefers a later meaningful json object over leading tool-call scaffolding in llm think turns', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '49e',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'think',
          response_text:
            'to=list_work_items ＿wrapperjson {"request_id":"operator-update-1","payload":{"headline":"raw leak"}}{"approach":"I found two existing intake items, so the next step is to route specialist work on one of them rather than create a new item."}',
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Think] I found two existing intake items, so the next step is to route specialist work on one of them rather than create a new item.',
    );
    expect(item.summary).toBe(
      'I found two existing intake items, so the next step is to route specialist work on one of them rather than create a new item.',
    );
    expect(item.summary).not.toContain('to=list_work_items');
  });

  it('suppresses llm act turns when they only contain helper-read fallbacks', () => {
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

  it('suppresses environment probes and helper-read leftovers when no operator-meaningful act remains', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44f',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'completed',
        role: 'spawn-agent-synthesis-specialist',
        task_id: 'task-44f',
        work_item_id: 'work-item-44f',
        activation_id: 'activation-44f',
        created_at: '2026-03-28T10:03:01.000Z',
        payload: {
          phase: 'act',
          llm_turn_count: 7,
          prompt_summary: 'Inspect the repository and verify Python availability before deeper work.',
        },
      }),
      createLogRow({
        id: '44g',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'completed',
        role: 'spawn-agent-synthesis-specialist',
        task_id: 'task-44f',
        work_item_id: 'work-item-44f',
        activation_id: 'activation-44f',
        created_at: '2026-03-28T10:03:02.000Z',
        payload: {
          llm_turn_count: 7,
          response_tool_calls: [
            {
              name: 'shell_exec',
              input: {
                command:
                  "bash --version >/tmp/bash_version.txt 2>&1 && python3 --version >/tmp/python3_version.txt 2>&1 && printf 'bash_ok\\npython3_ok\\n'",
                timeout: 30,
                max_output: 4000,
              },
            },
            {
              name: 'file_read',
              input: {
                path: 'README.md',
                limit: 200,
                offset: 1,
              },
            },
          ],
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses llm think, plan, and verify turns that only narrate reporting bookkeeping', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44a',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'think',
          response_text: JSON.stringify({
            approach:
              'I will record the required milestone operator brief and then submit the structured handoff for this activation.',
          }),
        },
      }),
      createLogRow({
        id: '44b',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'plan',
          response_text: JSON.stringify({
            summary:
              'Record the required milestone brief now, then submit the structured handoff summarizing the confirmed blocker.',
          }),
        },
      }),
      createLogRow({
        id: '44c',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'verify',
          response_text: JSON.stringify({
            reason:
              'The operator milestone was recorded successfully, but the activation still requires its structured handoff to satisfy the completion contract.',
          }),
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses llm plan turns that only say to emit the required operator brief', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44aa',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'plan',
          response_text: JSON.stringify({
            summary:
              'Emit the required milestone operator brief now that the activation has reached a meaningful wait-state checkpoint with delivery rework active.',
          }),
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('strips reporting boilerplate from useful think lines so the underlying workflow state survives', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '44d',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'think',
          response_text: JSON.stringify({
            approach:
              'I will record a milestone brief and submit a structured blocked handoff summarizing that implementation is waiting on human resolution of the delivery task replay conflict.',
          }),
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Think] Implementation is waiting on human resolution of the delivery task replay conflict.',
    );
  });

  it('strips activation-complete bookkeeping prefixes from verify lines', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '44e',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'verify',
          response_text: JSON.stringify({
            reason:
              "The activation's required orchestration work is complete: it handled the delivery-task escalation and implementation now waits for fresh engineer output.",
          }),
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Verify] It handled the delivery-task escalation and implementation now waits for fresh engineer output.',
    );
  });

  it('strips orchestrator-closure bookkeeping from think lines so only the workflow fact remains', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '44ea',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'think',
          response_text: JSON.stringify({
            approach:
              'I will record that the new security request-changes finding confirms implementation remains blocked on security-only rework, then close this orchestrator activation with a concise handoff.',
          }),
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Think] The new security request-changes finding confirms implementation remains blocked on security-only rework',
    );
  });

  it('suppresses llm plan turns whose only remaining action is to submit the orchestrator handoff', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44eb',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'plan',
          response_text: JSON.stringify({
            summary:
              'The required assessor routing checkpoint is recorded; the only remaining action in this activation is to submit the orchestrator handoff summarizing the new dispatch state and wait for the assessor results.',
          }),
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('strips alternate activation-complete bookkeeping prefixes from verify lines', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '44ec',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          phase: 'verify',
          response_text: JSON.stringify({
            reason:
              'This activation has completed its required orchestration work: it processed the implementation delivery handoff, routed the current revision into active quality and security assessment, and now waits for the assessor results.',
          }),
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Verify] It processed the implementation delivery handoff, routed the current revision into active quality and security assessment, and now waits for the assessor results.',
    );
  });

  it('collapses reporting-heavy think lines down to the underlying workflow fact', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '44ed',
        operation: 'agent.think',
        payload: {
          reasoning_summary:
            'I will record the release-pass wait-state and then submit a structured orchestrator handoff summarizing that implementation is cleared and release packaging is now in progress.',
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Think] Implementation is cleared and release packaging is now in progress.',
    );
    expect(item.summary).toBe('Implementation is cleared and release packaging is now in progress.');
  });

  it('suppresses generic reporting-capture tails that do not contain a useful workflow fact', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44ee0',
        operation: 'agent.think',
        payload: {
          reasoning_summary:
            'I will use the verified approved implementation evidence to record a milestone brief, confirm the release-pass work item state, and leave a structured handoff that captures the progression and next recommended action.',
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('suppresses verify rows whose only next step is internal handoff bookkeeping', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '44ee',
        operation: 'agent.verify',
        payload: {
          status: 'continue',
          summary:
            'The activation has now verified that release-pass work item is active and already has an in-progress release coordinator task, so the correct next step is to record the wait-state/operator brief and submit the orchestrator handoff for this activation rather than ending yet.',
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

  it('preserves execution-context work-item scope when structured tool calls only expose a task target', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '45a',
        category: 'llm',
        operation: 'llm.chat_stream',
        work_item_id: 'work-item-12',
        task_id: 'task-77',
        payload: {
          phase: 'act',
          response_tool_calls: [
            {
              name: 'submit_handoff',
              input: {
                task_id: 'task-77',
                summary: 'The design packet is ready for review.',
                completion: 'full',
              },
            },
          ],
        },
      }),
    ]);

    expect(item.work_item_id).toBe('work-item-12');
    expect(item.task_id).toBe('task-77');
    expect(item.linked_target_ids).toEqual(['workflow-1', 'work-item-12', 'task-77']);
    expect(item.scope_binding).toBe('structured_target');
  });

  it('surfaces hydrated llm act rows when the phase row is started and the companion row only carries tool calls', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '50b',
        category: 'llm',
        operation: 'llm.chat_stream',
        role: 'mixed-architecture-lead',
        task_id: 'task-50',
        work_item_id: 'work-item-50',
        activation_id: 'activation-50',
        status: 'completed',
        created_at: '2026-03-28T10:05:02.000Z',
        payload: {
          llm_turn_count: 6,
          response_tool_calls: [
            {
              name: 'submit_handoff',
              input: {
                summary:
                  'Delivered and verified a persisted technical design for the staged release-audit CLI.',
                completion: 'full',
              },
            },
          ],
        },
      }),
      createLogRow({
        id: '50a',
        category: 'llm',
        operation: 'llm.chat_stream',
        role: 'mixed-architecture-lead',
        task_id: 'task-50',
        work_item_id: 'work-item-50',
        activation_id: 'activation-50',
        status: 'started',
        created_at: '2026-03-28T10:05:01.000Z',
        payload: {
          phase: 'act',
          llm_turn_count: 6,
        },
      }),
    ]);

    expect(item).toEqual(
      expect.objectContaining({
        item_id: 'execution-log:50a',
        task_id: 'task-50',
        work_item_id: 'work-item-50',
        headline:
          '[Act] Submitting the handoff: Delivered and verified a persisted technical design for the staged release-audit CLI.',
      }),
    );
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
