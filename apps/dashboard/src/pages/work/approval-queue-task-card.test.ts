import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './approval-queue-task-card.tsx'), 'utf8');
}

describe('approval queue task card source', () => {
  it('keeps task approvals work-item centric and scroll-safe', () => {
    const source = readSource();
    expect(source).toContain('buildTaskApprovalBreadcrumbs');
    expect(source).toContain('readTaskOperatorFlowLabel');
    expect(source).toContain('Open board context');
    expect(source).toContain('QueueInfoTile');
    expect(source).toContain('Rework round');
    expect(source).toContain('Step approval');
    expect(source).toContain('Output gate');
    expect(source).toContain('usesWorkflowOperatorFlow');
    expect(source).toContain('Open Work Item Flow');
    expect(source).toContain('Open Workflow Context');
    expect(source).toContain('Open Step Diagnostics');
    expect(source).toContain('Open Step Record');
    expect(source).toContain('Step diagnostics');
    expect(source).toContain('usesWorkItemOperatorFlow');
    expect(source).toContain('const primaryTitleHref = workflowOperatorFlow && workflowContextLink');
    expect(source).toContain('const diagnosticsLabel = workflowOperatorFlow ? \'Open Step Diagnostics\' : \'Open Step Record\'');
    expect(source).toContain('buildApprovalDecisionPacket');
    expect(source).toContain('buildApprovalRecoveryPacket');
    expect(source).toContain('buildApprovalOutputPacket');
    expect(source).not.toContain('Current checkpoint');
    expect(source).not.toContain('current_checkpoint');
    expect(source).toContain('Current continuity');
    expect(source).toContain('Latest handoff');
    expect(source).toContain('Next expected actor');
    expect(source).toContain('Next expected action');
    expect(source).toContain('Successor context');
    expect(source).toContain('ReviewPacketCard');
    expect(source).toContain('View output preview');
    expect(source).toContain('DialogContent className="sm:max-w-lg"');
    expect(source).toContain('max-h-[75vh]');
    expect(source).toContain('overflow-y-auto');
    expect(source).toContain('className="min-h-[140px]"');
    expect(source).toContain('flex-wrap items-center justify-end gap-2');
  });
});
