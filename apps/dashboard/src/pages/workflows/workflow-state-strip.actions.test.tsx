import { describe, expect, it } from 'vitest';

import {
  createStickyStrip,
  createWorkflowCard,
  renderWorkflowStateStrip,
} from './workflow-state-strip.test-support.js';

describe('WorkflowStateStrip actions', () => {
  it('shows add-or-modify-work only when the platform marks it legal', () => {
    const hiddenHtml = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        availableActions: [
          {
            kind: 'pause_workflow',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'add_work_item',
            scope: 'workflow',
            enabled: false,
            confirmationLevel: 'standard_confirm',
            stale: false,
            disabledReason: 'Action is not available in the current workflow state.',
          },
        ],
      }),
    });
    const visibleHtml = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        availableActions: [
          {
            kind: 'pause_workflow',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'add_work_item',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'standard_confirm',
            stale: false,
            disabledReason: null,
          },
        ],
      }),
    });

    expect(hiddenHtml).not.toContain('Add Intake');
    expect(visibleHtml).toContain('Add Intake');
  });

  it('defaults the header CTA to Add Work for planned workflows when no scope-specific label is passed', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        lifecycle: 'planned',
        availableActions: [
          {
            kind: 'add_work_item',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'standard_confirm',
            stale: false,
            disabledReason: null,
          },
        ],
      }),
    });

    expect(html).toContain('Add Work');
    expect(html).not.toContain('Add Intake');
  });

  it('keeps workflow header actions hidden when the platform only authorizes narrower scopes', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        availableActions: [
          {
            kind: 'pause_workflow',
            scope: 'task',
            enabled: true,
            confirmationLevel: 'immediate',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'cancel_workflow',
            scope: 'work_item',
            enabled: true,
            confirmationLevel: 'high_impact_confirm',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'redrive_workflow',
            scope: 'task',
            enabled: true,
            confirmationLevel: 'high_impact_confirm',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'add_work_item',
            scope: 'work_item',
            enabled: true,
            confirmationLevel: 'standard_confirm',
            stale: false,
            disabledReason: null,
          },
        ],
      }),
      selectedScopeLabel: 'Task: Verify deliverable',
    });

    expect(html).not.toContain('Pause');
    expect(html).not.toContain('Cancel');
    expect(html).not.toContain('Redrive');
    expect(html).not.toContain('Add / Modify Work');
  });

  it('keeps workflow-only controls visible in the header while a narrower scope is selected', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        availableActions: [
          {
            kind: 'pause_workflow',
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
          {
            kind: 'redrive_workflow',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'high_impact_confirm',
            stale: false,
            disabledReason: null,
          },
          {
            kind: 'add_work_item',
            scope: 'workflow',
            enabled: true,
            confirmationLevel: 'standard_confirm',
            stale: false,
            disabledReason: null,
          },
        ],
      }),
      selectedScopeLabel: 'Review incoming packet',
      addWorkLabel: 'Modify Work',
    });

    expect(html).toContain('Pause');
    expect(html).toContain('Cancel');
    expect(html).toContain('Modify Work');
    expect(html).toContain('Playbook');
    expect(html).not.toContain('Redrive');
    expect(html).not.toContain('Steering');
    expect(html).not.toContain('Workflow-level actions only');
  });

  it('shows an explicit paused badge and only the legal lifecycle controls for paused workflows', () => {
    const html = renderWorkflowStateStrip({
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
            disabledReason: 'Action is not available in the current workflow state.',
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

    expect(html).toContain('Workflow paused');
    expect(html).toContain('Resume');
    expect(html).toContain('Cancel');
    expect(html).not.toContain('>Pause<');
  });
});
