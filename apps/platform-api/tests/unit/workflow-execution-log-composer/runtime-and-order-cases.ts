import { describe, expect, it } from 'vitest';

import { buildExecutionTurnItems, createLogRow } from './test-helpers.js';

describe('workflow-execution-log-composer runtime ordering cases', () => {
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
      'execution-log:31c-4',
      'execution-log:31c-5',
      'execution-log:31c-7',
    ]);
    expect(ascending[2]?.headline).toBe('[Observe] Observed errors while handling task creation.');
    expect(ascending[3]?.headline).toContain(
      'The task is not blocked permanently; the failed create_task call is recoverable',
    );
    expect(ascending[4]?.headline).toContain('Retry the blueprint dispatch with a schema-valid task payload');
    expect(ascending[4]?.headline).toContain('Close this activation cleanly');
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

  it('humanizes runtime observe rows for successful state checks', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '32a',
        operation: 'runtime.loop.observe',
        payload: {
          phase: 'observe',
          summary:
            'executed 2 tools (2 succeeded, 0 failed): read_latest_handoff, read_work_item_continuity',
          signal_tools: ['read_latest_handoff', 'read_work_item_continuity'],
          signal_mutation: false,
          errors_count: 0,
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Observe] Observed current results from latest brief and work item continuity.',
    );
    expect(item.summary).toBe(
      'Observed current results from latest brief and work item continuity.',
    );
  });

  it('humanizes runtime observe rows for failed mutations', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '32b',
        operation: 'runtime.loop.observe',
        payload: {
          phase: 'observe',
          summary:
            'executed 1 tools (0 succeeded, 1 failed): create_task. errors: create_task: validation failed',
          signal_tools: ['create_task'],
          signal_mutation: true,
          errors_count: 1,
        },
      }),
    ]);

    expect(item.headline).toBe('[Observe] Observed errors while handling task creation.');
    expect(item.summary).toBe('Observed errors while handling task creation.');
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
});
