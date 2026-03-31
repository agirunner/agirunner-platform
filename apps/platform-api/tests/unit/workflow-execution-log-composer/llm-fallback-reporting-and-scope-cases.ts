import { describe, expect, it } from 'vitest';

import {
  buildExecutionTurnItems,
  createLogRow,
  taskWorkspacePath,
  tempPath,
} from './test-helpers.js';

describe('workflow-execution-log-composer llm fallback, reporting, and scope cases', () => {
  it('uses helper-read fallbacks when the llm act turn only contains a tool-call wrapper', () => {
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
                path: taskWorkspacePath('task-1', 'context', 'task-input.json'),
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

  it('falls back to the remaining safe helper-read action when probe rows are suppressed', () => {
    const [item] = buildExecutionTurnItems([
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
                  `bash --version >${tempPath('bash_version.txt')} 2>&1 && python3 --version >${tempPath('python3_version.txt')} 2>&1 && printf 'bash_ok\\npython3_ok\\n'`,
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

    expect(item.headline).toBe('[Act] calling file_read(path="README.md:1-200")');
    expect(item.summary).toBe('calling file_read(path="README.md:1-200")');
    expect(item.source_label).toBe('Spawn Agent Synthesis Specialist');
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
          '[Act] Submitting the brief: Delivered and verified a persisted technical design for the staged release-audit CLI.',
      }),
    );
  });
});
