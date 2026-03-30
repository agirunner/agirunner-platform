import { describe, expect, it } from 'vitest';

import {
  createBoard,
  createStickyStrip,
  createWorkflowCard,
  renderWorkflowStateStrip,
} from './workflow-state-strip.test-support.js';

describe('WorkflowStateStrip fallbacks', () => {
  it('shows Resume instead of Pause for paused workflows and hides Resume once the workflow is cancelled', () => {
    const pausedHtml = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        state: 'paused',
        posture: 'paused',
        availableActions: [
          {
            kind: 'pause_workflow',
            scope: 'workflow',
            enabled: false,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: 'Only active workflows can be paused.',
          },
          {
            kind: 'resume_workflow',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'cancel_workflow',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'high_impact_confirm',
            stale: false,
            disabledReason: null,
          },
        ],
      }),
      stickyStrip: createStickyStrip({ posture: 'paused' }),
    });
    const cancelledHtml = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        state: 'cancelled',
        posture: 'cancelled',
        availableActions: [
          {
            kind: 'pause_workflow',
            scope: 'workflow',
            enabled: false,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: 'Only active workflows can be paused.',
          },
          {
            kind: 'resume_workflow',
            scope: 'workflow',
            enabled: false,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: 'Cancelled workflows cannot be resumed.',
          },
          {
            kind: 'cancel_workflow',
            scope: 'workflow',
            enabled: false,
            confirmationLevel: 'high_impact_confirm',
            stale: false,
            disabledReason: 'Action is not available in the current workflow state.',
          },
        ],
      }),
      stickyStrip: createStickyStrip({ posture: 'cancelled' }),
    });

    expect(pausedHtml).toContain('Resume</button>');
    expect(pausedHtml).not.toContain('>Pause</button>');
    expect(cancelledHtml).not.toContain('>Resume</button>');
    expect(cancelledHtml).not.toContain('>Pause</button>');
  });

  it('keeps Cancel visible for pending workflows even when fallback header actions are synthesised locally', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        state: 'pending',
        posture: 'waiting_by_design',
        availableActions: [],
      }),
      stickyStrip: createStickyStrip({ posture: 'waiting_by_design' }),
    });

    expect(html).toContain('Cancel</button>');
    expect(html).not.toContain('>Pause</button>');
    expect(html).not.toContain('>Resume</button>');
  });

  it('falls back to paused workflow state for lifecycle controls when workflow actions have not loaded yet', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        state: 'paused',
        posture: 'paused',
        availableActions: [],
      }),
      stickyStrip: createStickyStrip({ posture: 'paused' }),
    });

    expect(html).toContain('Workflow paused');
    expect(html).toContain('Resume');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('>Pause<');
  });

  it('does not render pause or resume controls for cancelled workflows', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        state: 'cancelled',
        posture: 'cancelled',
        availableActions: [],
      }),
      stickyStrip: createStickyStrip({ posture: 'cancelled' }),
    });

    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Resume<');
    expect(html).not.toContain('>Cancel<');
  });

  it('does not render resume or cancel controls while a paused workflow is already cancelling and actions have not loaded yet', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        state: 'paused',
        posture: 'cancelling',
        availableActions: [],
      }),
      stickyStrip: createStickyStrip({ posture: 'cancelling' }),
    });

    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Resume<');
    expect(html).not.toContain('>Cancel<');
  });

  it('describes pre-dispatch activity as workflow orchestration instead of hidden board work', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        metrics: {
          ...createWorkflowCard().metrics,
          activeTaskCount: 1,
          activeWorkItemCount: 0,
        },
      }),
      stickyStrip: createStickyStrip({
        active_task_count: 1,
        active_work_item_count: 0,
      }),
      board: createBoard({
        work_items: [],
      }),
    });

    expect(html).toContain('Orchestrating workflow setup');
    expect(html).not.toContain('Routing new work');
  });
});
