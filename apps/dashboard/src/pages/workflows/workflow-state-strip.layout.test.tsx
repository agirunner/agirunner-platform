import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  createStickyStrip,
  createWorkflowCard,
  renderWorkflowStateStrip,
} from './workflow-state-strip.test-support.js';

describe('WorkflowStateStrip layout', () => {
  it('removes the per-workflow live visibility control from the header so controls stay focused on workflow actions', () => {
    const source = [
      readFileSync(new URL('./workflow-state-strip.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('./workflow-state-strip.support.ts', import.meta.url), 'utf8'),
    ].join('\n');

    expect(source).toContain('xl:items-start');
    expect(source).toContain(
      'className="flex min-w-0 flex-wrap items-start justify-start gap-2 xl:justify-end xl:pl-2"',
    );
    expect(source).not.toContain('Live visibility');
    expect(source).not.toContain('workflow-live-visibility-');
    expect(source).toContain("action.kind !== 'redrive_workflow'");
    expect(source).not.toContain('onOpenRedrive');
    expect(source).not.toContain('>Controls<');
  });

  it('renders the add-work CTA from a passed label instead of a hardcoded generic header label', () => {
    const source = readFileSync(new URL('./workflow-state-strip.tsx', import.meta.url), 'utf8');

    expect(source).toContain('props.addWorkLabel');
    expect(source).not.toContain('Add / Modify Work');
  });

  it('shows active stage posture and workload shape from the board', () => {
    const html = renderWorkflowStateStrip();

    expect(html).toContain('Work Items');
    expect(html).toContain('2 completed');
    expect(html).toContain('Specialist Tasks');
    expect(html).toContain('Playbook');
    expect(html).toContain('Release Playbook');
    expect(html).toContain('href="/design/playbooks/playbook-1"');
    expect(html).toContain('Updated');
    expect(html).toContain('3 active tasks');
    expect(html).not.toContain('Live visibility');
    expect(html).not.toContain('Workspace');
  });

  it('counts only unresolved approvals and escalations in the needs-action summary card', () => {
    const html = renderWorkflowStateStrip();
    const overriddenHtml = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        metrics: {
          ...createWorkflowCard().metrics,
          blockedWorkItemCount: 4,
        },
      }),
      stickyStrip: createStickyStrip({
        approvals_count: 1,
        escalations_count: 1,
        blocked_work_item_count: 4,
      }),
    });

    expect(html).toContain('Needs Action');
    expect(overriddenHtml).toContain('>2<');
    expect(overriddenHtml).toContain('1 approval');
    expect(overriddenHtml).toContain('1 escalation');
    expect(overriddenHtml).not.toContain('4 blocked');
  });

  it('uses singular workload grammar when only one specialist task is active', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        metrics: {
          ...createWorkflowCard().metrics,
          activeTaskCount: 1,
        },
      }),
      stickyStrip: createStickyStrip({
        active_task_count: 1,
      }),
    });

    expect(html).toContain('1 active task');
    expect(html).not.toContain('1 active tasks');
  });

  it('keeps the sticky cards compact and uses operator-friendly workflow badges', () => {
    const html = renderWorkflowStateStrip({
      workflow: createWorkflowCard({
        lifecycle: 'ongoing',
        currentStage: null,
        posture: 'waiting_by_design',
        metrics: {
          ...createWorkflowCard().metrics,
          activeTaskCount: 0,
          activeWorkItemCount: 0,
        },
      }),
      stickyStrip: createStickyStrip({
        posture: 'waiting_by_design',
        active_task_count: 0,
        active_work_item_count: 0,
      }),
      selectedScopeLabel: 'workflows-intake-01',
    });

    expect(html).toContain('Waiting for Work');
    expect(html).toContain('Ongoing');
    expect(html).toContain('Routing next step');
    expect(html).toContain('Specialist Tasks');
    expect(html).toContain('Work Items');
    expect(html).not.toContain('Waiting By Design');
    expect(html).not.toContain('Workflow is waiting by design');
    expect(html).not.toContain('Awaiting Intake');
    expect(html).not.toContain('Live visibility');
    expect(html).toContain('rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-left shadow-sm');
    expect(html).not.toContain('Requests and responses');
    expect(html).not.toContain('Accepting new work');
  });

  it('uses the same value scale and weight across all four summary cards', () => {
    const html = renderWorkflowStateStrip();

    expect(html.match(/text-base font-semibold leading-5 text-foreground/g)?.length ?? 0).toBe(4);
    expect(html).not.toContain('text-sm font-semibold leading-5 text-foreground sm:text-base');
  });

  it('shows the selected work-item scope as a compact narrowed row when a narrower slice is focused', () => {
    const html = renderWorkflowStateStrip({
      selectedScopeLabel: 'Verify release candidate',
    });

    expect(html).toContain('Work item');
    expect(html).toContain('Verify release candidate');
    expect(html).not.toContain('Workbench scope');
    expect(html).not.toContain('Viewing:');
  });
});
