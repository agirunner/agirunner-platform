import { describe, expect, it } from 'vitest';

import {
  buildExecutionTurnItems,
  createLogRow,
  taskWorkspacePath,
} from './test-helpers.js';

describe('workflow-execution-log-composer llm action cases', () => {
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
      '[Act] Submitting the brief: Triage packet is ready for policy assessment.',
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
      '[Act] Submitting the brief: The delivery task for the work item was rerouted and implementation can resume.',
    );
    expect(item.summary).toBe(
      'Submitting the brief: The delivery task for the work item was rerouted and implementation can resume.',
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

  it('surfaces helper file_read turns when safe args are available', () => {
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
                path: taskWorkspacePath('task-123', 'context', 'task-input.json'),
                offset: 1,
                limit: 80,
              },
            },
          ],
        },
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.headline).toBe('[Act] calling file_read(path="task input")');
    expect(items[0]?.summary).toBe('calling file_read(path="task input")');
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
      '[Plan] Submitting the brief: Release package needs revision before release-pass can close.',
    );
    expect(item.summary).toBe(
      'Submitting the brief: Release package needs revision before release-pass can close.',
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
      '[Act] Submitting the brief: Implementation revision 3 is approved and ready for release-readiness routing.',
    );
    expect(item.summary).toBe(
      'Submitting the brief: Implementation revision 3 is approved and ready for release-readiness routing.',
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
});
