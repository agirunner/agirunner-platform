import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './task-detail-page.tsx'), 'utf8');
}

describe('task detail page source', () => {
  it('surfaces specialist task context and v2 workflow scope fields', () => {
    const source = readSource();
    expect(source).toContain('describeTaskKind');
    expect(source).toContain('Orchestrator activation');
    expect(source).toContain('execution_backend');
    expect(source).toContain('used_task_sandbox');
    expect(source).toContain('describeExecutionBackendSurface');
    expect(source).toContain('describeExecutionUsageSurface');
    expect(source).toContain('describeExecutionSurface(task)');
    expect(source).toContain('work_item_id');
    expect(source).toContain('activation_id');
    expect(source).toContain('execution_environment');
    expect(source).toContain('Execution environment');
    expect(source).toContain('Package manager');
    expect(source).toContain('Stage');
  });

  it('handles output assessment and escalation-aware operator actions', () => {
    const source = readSource();
    expect(source).toContain('approveTaskOutput');
    expect(source).toContain('overrideTaskOutput');
    expect(source).toContain('escalated');
    expect(source).toContain('dashboardApi.listAgents()');
    expect(source).toContain('dashboardApi.reassignTask');
    expect(source).toContain('dashboardApi.escalateTask');
    expect(source).toContain('Open Escalation Context');
    expect(source).toContain('Open Work Item Flow');
    expect(source).toContain('buildWorkflowOperatorPermalink');
    expect(source).toContain('usesWorkflowOperatorFlow');
    expect(source).toContain('workflowOperatorPermalink');
    expect(source).toContain('TaskDetailContextSection');
    expect(source).toContain('Operator Output Packet');
    expect(source).toContain('Override Output');
    expect(source).toContain('StepOutputOverrideDialog');
    expect(source).toContain('WorkItemReassignDialog');
    expect(source).toContain('StepManualEscalationDialog');
    expect(source).toContain('Reassign Step');
    expect(source).toContain('Escalate Step');
    expect(source).not.toContain("status === 'running' || status === 'claimed'");
    expect(source).toContain("return 'Specialist step'");
  });

  it('renders an operator-first packet instead of a raw output dump', () => {
    const source = readSource();
    expect(source).toContain('Recommended next move');
    expect(source).toContain('Review the rendered output first');
    expect(source).toContain('Raw payload');
    expect(source).toContain('TaskDetailContextSection');
    expect(source).toContain('grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-4');
    expect(source).toContain('This specialist step belongs to a workflow work item.');
    expect(source).toContain('This specialist step is attached to a workflow stage without a linked work item yet.');
    expect(source).toContain('Open Workflow Operator Flow');
    expect(source).toContain('Use the workflow operator flow so board context stays aligned before mutating the step directly.');
    expect(source).toContain('Override the stored output packet');
  });

  it('guards raw approve/reject/retry/cancel buttons behind the workflow operator flow check', () => {
    const source = readSource();
    const guardPos = source.indexOf('workflowOperatorPermalink && workflowOperatorFlow');
    const approvePos = source.indexOf('Approve Step');
    const rejectPos = source.indexOf('Reject Step');
    const retryPos = source.indexOf('Retry Step');
    expect(guardPos).toBeGreaterThan(-1);
    expect(approvePos).toBeGreaterThan(guardPos);
    expect(rejectPos).toBeGreaterThan(guardPos);
    expect(retryPos).toBeGreaterThan(guardPos);
  });
});
