import { describe, expect, it } from 'vitest';

import {
  buildBreadcrumb,
  clearSelection,
  initialCanvasState,
  navigateBreadcrumb,
  selectTask,
  selectWorkflow,
} from './execution-canvas-support.js';

describe('execution canvas state helpers', () => {
  it('initialCanvasState returns correct defaults', () => {
    const state = initialCanvasState();

    expect(state.viewMode).toBe('war-room');
    expect(state.controlMode).toBe('inline');
    expect(state.depthLevel).toBe(1);
    expect(state.panel.isOpen).toBe(false);
    expect(state.panel.workflowId).toBeNull();
    expect(state.panel.taskId).toBeNull();
    expect(state.panel.breadcrumb).toEqual([{ type: 'overview', label: 'Overview' }]);
    expect(state.resourcePanelOpen).toBe(false);
    expect(state.launchWizardOpen).toBe(false);
    expect(state.commandPaletteOpen).toBe(false);
  });

  it('selectWorkflow opens panel with correct breadcrumb', () => {
    const state = initialCanvasState();
    const next = selectWorkflow(state, 'wf-123', 'My Workflow');

    expect(next.panel.isOpen).toBe(true);
    expect(next.panel.workflowId).toBe('wf-123');
    expect(next.panel.taskId).toBeNull();
    expect(next.panel.breadcrumb).toEqual([
      { type: 'overview', label: 'Overview' },
      { type: 'workflow', id: 'wf-123', label: 'My Workflow' },
    ]);
  });

  it('selectTask adds task to breadcrumb', () => {
    const state = initialCanvasState();
    const withWorkflow = selectWorkflow(state, 'wf-123', 'My Workflow');
    const withTask = selectTask(withWorkflow, 'task-456', 'My Task');

    expect(withTask.panel.isOpen).toBe(true);
    expect(withTask.panel.workflowId).toBe('wf-123');
    expect(withTask.panel.taskId).toBe('task-456');
    expect(withTask.panel.breadcrumb).toEqual([
      { type: 'overview', label: 'Overview' },
      { type: 'workflow', id: 'wf-123', label: 'My Workflow' },
      { type: 'task', id: 'task-456', label: 'My Task' },
    ]);
  });

  it('selectTask requires open panel — returns state unchanged if panel closed', () => {
    const state = initialCanvasState();
    const result = selectTask(state, 'task-456', 'My Task');

    expect(result).toEqual(state);
  });

  it('clearSelection resets everything', () => {
    const state = initialCanvasState();
    const withWorkflow = selectWorkflow(state, 'wf-123', 'My Workflow');
    const withTask = selectTask(withWorkflow, 'task-456', 'My Task');
    const cleared = clearSelection(withTask);

    expect(cleared.panel.isOpen).toBe(false);
    expect(cleared.panel.workflowId).toBeNull();
    expect(cleared.panel.taskId).toBeNull();
    expect(cleared.panel.breadcrumb).toEqual([{ type: 'overview', label: 'Overview' }]);
  });

  it('navigateBreadcrumb(0) returns to overview', () => {
    const state = initialCanvasState();
    const withWorkflow = selectWorkflow(state, 'wf-123', 'My Workflow');
    const result = navigateBreadcrumb(withWorkflow, 0);

    expect(result.panel.isOpen).toBe(false);
    expect(result.panel.workflowId).toBeNull();
    expect(result.panel.taskId).toBeNull();
    expect(result.panel.breadcrumb).toEqual([{ type: 'overview', label: 'Overview' }]);
  });

  it('navigateBreadcrumb(1) from task level returns to workflow level', () => {
    const state = initialCanvasState();
    const withWorkflow = selectWorkflow(state, 'wf-123', 'My Workflow');
    const withTask = selectTask(withWorkflow, 'task-456', 'My Task');
    const result = navigateBreadcrumb(withTask, 1);

    expect(result.panel.isOpen).toBe(true);
    expect(result.panel.workflowId).toBe('wf-123');
    expect(result.panel.taskId).toBeNull();
    expect(result.panel.breadcrumb).toEqual([
      { type: 'overview', label: 'Overview' },
      { type: 'workflow', id: 'wf-123', label: 'My Workflow' },
    ]);
  });

  it('buildBreadcrumb returns correct entries for overview-only state', () => {
    const state = initialCanvasState();
    const crumbs = buildBreadcrumb(state.panel);

    expect(crumbs).toEqual([{ type: 'overview', label: 'Overview' }]);
  });

  it('buildBreadcrumb returns correct entries for workflow-focused state', () => {
    const state = initialCanvasState();
    const withWorkflow = selectWorkflow(state, 'wf-123', 'My Workflow');
    const crumbs = buildBreadcrumb(withWorkflow.panel);

    expect(crumbs).toEqual([
      { type: 'overview', label: 'Overview' },
      { type: 'workflow', id: 'wf-123', label: 'My Workflow' },
    ]);
  });

  it('buildBreadcrumb returns correct entries for task-focused state', () => {
    const state = initialCanvasState();
    const withWorkflow = selectWorkflow(state, 'wf-123', 'My Workflow');
    const withTask = selectTask(withWorkflow, 'task-456', 'My Task');
    const crumbs = buildBreadcrumb(withTask.panel);

    expect(crumbs).toEqual([
      { type: 'overview', label: 'Overview' },
      { type: 'workflow', id: 'wf-123', label: 'My Workflow' },
      { type: 'task', id: 'task-456', label: 'My Task' },
    ]);
  });
});
