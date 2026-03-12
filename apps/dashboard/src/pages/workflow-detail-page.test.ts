import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  shouldInvalidateWorkflowRealtimeEvent,
  summarizeTasks,
} from './workflow-detail-support.js';

describe('workflow mission-control summary', () => {
  it('counts task states into mission-control buckets', () => {
    const summary = summarizeTasks([
      { state: 'ready' },
      { state: 'running' },
      { state: 'claimed' },
      { state: 'awaiting_approval' },
      { state: 'output_pending_review' },
      { state: 'awaiting_escalation' },
      { state: 'completed' },
      { state: 'failed' },
      { state: 'cancelled' },
      { state: 'blocked' },
    ]);

    expect(summary).toEqual({
      total: 10,
      ready: 1,
      in_progress: 2,
      blocked: 4,
      completed: 1,
      failed: 2,
    });
  });
});

describe('workflow detail realtime invalidation scope', () => {
  it('invalidates on workflow events only when entity matches current workflow', () => {
    expect(
      shouldInvalidateWorkflowRealtimeEvent('workflow.state_changed', 'pipe-1', {
        entity_type: 'workflow',
        entity_id: 'pipe-1',
      }),
    ).toBe(true);

    expect(
      shouldInvalidateWorkflowRealtimeEvent('workflow.state_changed', 'pipe-1', {
        entity_type: 'workflow',
        entity_id: 'pipe-2',
      }),
    ).toBe(false);
  });

  it('invalidates task events only when payload carries matching workflow id', () => {
    expect(
      shouldInvalidateWorkflowRealtimeEvent('task.state_changed', 'pipe-1', {
        data: { workflow_id: 'pipe-1' },
      }),
    ).toBe(true);

    expect(
      shouldInvalidateWorkflowRealtimeEvent('task.state_changed', 'pipe-1', {
        data: { workflow_id: 'pipe-2' },
      }),
    ).toBe(false);
  });

  it('ignores task events without workflow id to prevent cross-workflow churn', () => {
    expect(
      shouldInvalidateWorkflowRealtimeEvent('task.state_changed', 'pipe-1', {
        entity_type: 'task',
        entity_id: 'task-abc',
        data: { from_state: 'ready', to_state: 'in_progress' },
      }),
    ).toBe(false);
  });
});

describe('workflow detail continuous stage display', () => {
  it('derives live stages from active stage sources instead of preferring current_stage', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-detail-page.tsx'),
      'utf8',
    );

    expect(source).toContain('deriveWorkflowStageDisplay');
    expect(source).toContain("label: 'Live stages'");
    expect(source).toContain('workflow.work_item_summary?.active_stage_names');
    expect(source).not.toContain('value: workflow.current_stage ?? null');
  });
});

describe('workflow detail model override display', () => {
  it('loads workflow overrides and resolved effective models for the detail view', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-detail-page.tsx'),
      'utf8',
    );

    expect(source).toContain('dashboardApi.getWorkflowModelOverrides(workflowId)');
    expect(source).toContain('dashboardApi.getResolvedWorkflowModels(workflowId)');
    expect(source).toContain('<h3>Model Overrides</h3>');
    expect(source).toContain('<h3>Effective Models</h3>');
    expect(source).toContain('ResolvedModelResolutionList');
  });
});

describe('workflow detail deep links', () => {
  it('reads work item, activation, child workflow, and gate selection from url params', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-detail-page.tsx'),
      'utf8',
    );

    expect(source).toContain("searchParams.get('work_item')");
    expect(source).toContain("searchParams.get('activation')");
    expect(source).toContain("searchParams.get('child')");
    expect(source).toContain("searchParams.get('gate')");
    expect(source).toContain("updateWorkflowSelection('work_item'");
    expect(source).toContain("updateWorkflowSelection('activation'");
    expect(source).toContain("updateWorkflowSelection('child'");
    expect(source).toContain("updateWorkflowSelection('gate'");
  });

  it('groups board work items for milestone-aware selection and task rollup', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-detail-page.tsx'),
      'utf8',
    );

    expect(source).toContain('groupWorkflowWorkItems');
    expect(source).toContain('flattenGroupedWorkItems');
    expect(source).toContain('findWorkItemById');
    expect(source).toContain('selectTasksForWorkItem(workItemTasks, selectedWorkItemId, groupedWorkItems)');
    expect(source).toContain('selectedWorkItem={selectedBoardWorkItem}');
  });

  it('broadens workflow detail invalidation to board, stages, activations, gates, and effective models', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-detail-query.ts'),
      'utf8',
    );

    expect(source).toContain("['workflow-board', workflowId]");
    expect(source).toContain("['workflow-stages', workflowId]");
    expect(source).toContain("['workflow-activations', workflowId]");
    expect(source).toContain("['workflow-gates', workflowId]");
    expect(source).toContain("['workflow-model-overrides', workflowId]");
    expect(source).toContain("['workflow-resolved-models', workflowId]");
  });

  it('fails closed on non-playbook workflow records without template-era fallback messaging', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, './workflow-detail-page.tsx'),
      'utf8',
    );

    expect(source).toContain('This detail view requires a playbook-backed workflow record.');
    expect(source).not.toContain('Legacy Workflow Removed');
    expect(source).not.toContain('Template and phase-era workflow interaction');
  });
});
