import { describe, expect, it } from 'vitest';

import {
  buildExecutionTurnItems,
  createLogRow,
  taskWorkspacePath,
  tempPath,
} from './test-helpers.js';

describe('workflow-execution-log-composer path and shell cases', () => {
  it('surfaces file reads with a safe path-range summary when it can be derived', () => {
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
      '[Act] calling file_read(path="output/workflows-intake-01-triage-packet.md:1-200")',
    );
    expect(item.summary).toBe(
      'calling file_read(path="output/workflows-intake-01-triage-packet.md:1-200")',
    );
  });

  it('surfaces temp workspace context reads with a sanitized task-context label', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22da',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          input: {
            path: taskWorkspacePath('task-4df24677-e56d-42e5-9c75-d86e9d8c01cf', 'context', 'current-task.md'),
            offset: 1,
            limit: 200,
          },
        },
      }),
    ]);

    expect(item.headline).toBe('[Act] calling file_read(path="task context")');
    expect(item.summary).toBe('calling file_read(path="task context")');
  });

  it('humanizes artifact uploads instead of exposing raw tool syntax', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22db',
        operation: 'agent.act',
        payload: {
          tool: 'artifact_upload',
          input: {
            path: taskWorkspacePath('task-4df24677-e56d-42e5-9c75-d86e9d8c01cf', 'output', 'release-packet.md'),
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
            cwd: taskWorkspacePath('task-4df24677-e56d-42e5-9c75-d86e9d8c01cf'),
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
            context_path: taskWorkspacePath('task-4df24677-e56d-42e5-9c75-d86e9d8c01cf', 'context', 'current-task.md'),
            request_id: 'handoff-1',
            work_item_id: 'work-item-1',
          },
        },
      }),
    ]);

    expect(item.headline).toBe(
      '[Act] Submitting the brief: Completed the intake-triage deliverable for workflows-intake-01.',
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
      '[Verify] The brief is blocked until the required target URL is available.',
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
                command:
                  `bash --version >${tempPath('bash_version.txt')} 2>&1 && python3 --version >${tempPath('python_version.txt')} 2>&1`,
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

  it('keeps helper-read act rows when they narrate a specific read in plain text', () => {
    const [item] = buildExecutionTurnItems([
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

    expect(item.headline).toBe('[Act] Read the task input packet before deciding the next step.');
    expect(item.summary).toBe('Read the task input packet before deciding the next step.');
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
});
