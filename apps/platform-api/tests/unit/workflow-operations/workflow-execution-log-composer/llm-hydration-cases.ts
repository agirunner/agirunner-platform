import { describe, expect, it } from 'vitest';

import {
  buildExecutionTurnItems,
  createLogRow,
  taskWorkspacePath,
} from './test-helpers.js';

describe('workflow-execution-log-composer llm hydration cases', () => {
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
        id: '47c',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'started',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:04.500Z',
        payload: {
          phase: 'observe',
          llm_turn_count: 6.5,
        },
      }),
      createLogRow({
        id: '47d',
        category: 'llm',
        operation: 'llm.chat_stream',
        task_id: 'task-1',
        activation_id: 'activation-split',
        role: 'orchestrator',
        created_at: '2026-03-28T10:00:04.600Z',
        payload: {
          llm_turn_count: 6.5,
          response_text: JSON.stringify({
            summary: 'Observed the active architecture lead handoff and confirmed implementation should still wait.',
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
      '[Plan] Wait for the architecture lead brief before routing implementation.',
      '[Observe] Observed the active architecture lead brief and confirmed implementation should still wait.',
      '[Verify] The design work is still waiting on the active architecture task.',
    ]);
    expect(items.map((item) => item.item_id)).toEqual([
      'execution-log:46a',
      'execution-log:47a',
      'execution-log:47c',
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
                  path: taskWorkspacePath('task-2', 'output', 'design.md'),
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
});
