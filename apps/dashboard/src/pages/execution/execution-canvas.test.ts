import { describe, expect, it } from 'vitest';

import { ExecutionCanvas } from './execution-canvas.js';
import { initialCanvasState, selectWorkflow, clearSelection } from './execution-canvas-support.js';
import { subscribeToEvents } from '../../lib/sse.js';

describe('ExecutionCanvas', () => {
  it('exports ExecutionCanvas as a function', () => {
    expect(typeof ExecutionCanvas).toBe('function');
  });
});

describe('canvas state initialization', () => {
  it('initializes with war-room view mode', () => {
    const state = initialCanvasState();
    expect(state.viewMode).toBe('war-room');
  });

  it('initializes with panel closed', () => {
    const state = initialCanvasState();
    expect(state.panel.isOpen).toBe(false);
  });

  it('initializes with no selected workflow or task', () => {
    const state = initialCanvasState();
    expect(state.panel.workflowId).toBeNull();
    expect(state.panel.taskId).toBeNull();
  });

  it('initializes with overview breadcrumb only', () => {
    const state = initialCanvasState();
    expect(state.panel.breadcrumb).toHaveLength(1);
    expect(state.panel.breadcrumb[0]?.type).toBe('overview');
  });
});

describe('onSelectWorkflow updates panel state', () => {
  it('opens the panel with the selected workflow', () => {
    const state = initialCanvasState();
    const next = selectWorkflow(state, 'wf-1', 'My Workflow');
    expect(next.panel.isOpen).toBe(true);
    expect(next.panel.workflowId).toBe('wf-1');
  });

  it('appends a workflow breadcrumb entry', () => {
    const state = initialCanvasState();
    const next = selectWorkflow(state, 'wf-1', 'My Workflow');
    expect(next.panel.breadcrumb).toHaveLength(2);
    expect(next.panel.breadcrumb[1]?.type).toBe('workflow');
    expect(next.panel.breadcrumb[1]?.label).toBe('My Workflow');
  });
});

describe('onClearSelection resets panel state', () => {
  it('closes the panel after a workflow is selected', () => {
    const state = selectWorkflow(initialCanvasState(), 'wf-1', 'My Workflow');
    const cleared = clearSelection(state);
    expect(cleared.panel.isOpen).toBe(false);
    expect(cleared.panel.workflowId).toBeNull();
  });

  it('resets breadcrumb to overview-only', () => {
    const state = selectWorkflow(initialCanvasState(), 'wf-1', 'My Workflow');
    const cleared = clearSelection(state);
    expect(cleared.panel.breadcrumb).toHaveLength(1);
    expect(cleared.panel.breadcrumb[0]?.type).toBe('overview');
  });
});

describe('event subscription setup', () => {
  it('subscribeToEvents is callable and returns an unsubscribe function', () => {
    const unsubscribe = subscribeToEvents(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });
});
