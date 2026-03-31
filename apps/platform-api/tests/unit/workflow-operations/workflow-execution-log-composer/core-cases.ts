import { describe, expect, it } from 'vitest';

import {
  buildExecutionTurnItems,
  buildLifecycleHistoryItems,
  createLogRow,
  taskWorkspacePath,
} from './test-helpers.js';

describe('workflow-execution-log-composer core cases', () => {
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
      '[Act] Submitting the brief: Triage packet is ready for policy assessment.',
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
      '[Act] Submitting the brief: Triage packet is ready for policy assessment.',
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

  it('surfaces helper reads as safe tool-call fallbacks when a sanitized path exists', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22cc',
        operation: 'agent.act',
        payload: {
          tool: 'file_read',
          text_preview: 'calling file_read()',
          input: {
            path: taskWorkspacePath('task-4df24677-e56d-42e5-9c75-d86e9d8c01cf', 'context', 'task-input.json'),
          },
        },
      }),
    ]);

    expect(item.headline).toBe('[Act] calling file_read(path="task input")');
    expect(item.summary).toBe('[Act] calling file_read(path="task input")'.replace(/^\[Act\]\s/, ''));
  });

  it('suppresses generic empty tool-call wrappers instead of degrading them into filler act turns', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22cd',
        operation: 'agent.act',
        payload: {
          tool: 'submit_handoff',
          text_preview: 'calling submit_handoff()',
          input: {
            request_id: 'handoff-1',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });

  it('surfaces list helpers as safe tool-call fallbacks when they expose operator-safe args', () => {
    const [item] = buildExecutionTurnItems([
      createLogRow({
        id: '22ce',
        operation: 'agent.act',
        payload: {
          tool: 'file_list',
          text_preview: 'calling file_list()',
          input: {
            path: 'repo/docs',
          },
        },
      }),
    ]);

    expect(item.headline).toBe('[Act] calling file_list(path="docs")');
  });

  it('suppresses low-value task-status reads and lets observe/plan rows carry the wait state', () => {
    const items = buildExecutionTurnItems([
      createLogRow({
        id: '22cf',
        operation: 'agent.act',
        payload: {
          tool: 'read_task_status',
          text_preview: 'calling read_task_status(task_id="task-1")',
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
        id: '22cg',
        operation: 'agent.act',
        payload: {
          tool: 'read_work_item_continuity',
          text_preview: 'calling read_work_item_continuity(work_item_id="work-item-1")',
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
        id: '22ch',
        operation: 'agent.act',
        payload: {
          tool: 'create_task',
          text_preview: 'calling create_task()',
          input: {
            request_id: 'task-create-r1',
            work_item_id: 'work-item-1',
          },
        },
      }),
    ]);

    expect(items).toEqual([]);
  });
});
