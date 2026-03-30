import { describe, expect, it } from 'vitest';

import type { DashboardWorkflowNeedsActionItem } from '../../../lib/api.js';
import {
  buildNeedsActionDossier,
  buildPromptMeta,
  isVisibleNeedsActionResponse,
  normalizeNeedsActionScope,
  readScopedAwayWorkflowMessage,
  readSuccessMessage,
} from './workflow-needs-action.support.js';

describe('workflow-needs-action support', () => {
  it('builds an operator-facing dossier from the needs-action packet details', () => {
    const dossier = buildNeedsActionDossier(createItem(), 'work_item');

    expect(dossier.needsDecision).toBe('Approve release packet.');
    expect(dossier.whyItNeedsAction).toBe(
      'Review release packet is waiting for operator approval.',
    );
    expect(dossier.blockingNow).toBe(
      'Waiting on operator sign-off before packaging can continue.',
    );
    expect(dossier.workSoFar).toBe(
      'Release packet draft and rollback notes are assembled for sign-off.',
    );
    expect(dossier.recommendedAction).toBe('Approve');
    expect(dossier.evidence).toBe(
      'Release packet verification passed and the required artifacts are attached.',
    );
  });

  it('normalizes task scope down to the parent work-item view', () => {
    expect(normalizeNeedsActionScope('task', 'Task: Verify deliverable')).toEqual({
      subject: 'work item',
      label: 'This work item',
    });
  });

  it('keeps only approval/escalation responses and preserves the operator prompt metadata', () => {
    const visibleResponses = createItem().responses.filter(isVisibleNeedsActionResponse);

    expect(visibleResponses.map((action) => action.kind)).toEqual([
      'approve_task',
      'request_changes_task',
    ]);
    expect(buildPromptMeta(visibleResponses[1] ?? null)).toEqual({
      title: 'Request changes',
      description:
        'Attach explicit operator feedback to this task so the next workflow step is clear.',
      placeholder: 'Describe the changes or rejection reason...',
      confirmLabel: 'Request changes',
      requiredMessage: 'Enter review feedback before continuing.',
    });
    expect(readSuccessMessage('approve_task')).toBe('Approval recorded');
    expect(readScopedAwayWorkflowMessage(2)).toBe(
      '2 workflow-level actions remain available in workflow scope.',
    );
  });
});

function createItem(): DashboardWorkflowNeedsActionItem {
  return {
    action_id: 'task-approve-1:awaiting_approval',
    action_kind: 'review_work_item',
    label: 'Approval required',
    summary: 'Review release packet is waiting for operator approval.',
    work_item_id: 'work-item-1',
    target: {
      target_kind: 'task',
      target_id: 'task-approve-1',
    },
    priority: 'high',
    requires_confirmation: true,
    submission: {
      route_kind: 'task_mutation',
      method: 'POST',
    },
    details: [
      { label: 'Approval target', value: 'Approve release packet' },
      {
        label: 'Blocking state',
        value: 'Waiting on operator sign-off before packaging can continue.',
      },
      {
        label: 'Work so far',
        value: 'Release packet draft and rollback notes are assembled for sign-off.',
      },
      {
        label: 'Verification',
        value: 'Release packet verification passed and the required artifacts are attached.',
      },
    ],
    responses: [
      {
        action_id: 'task-approve-1:approve',
        kind: 'approve_task',
        label: 'Approve',
        target: {
          target_kind: 'task',
          target_id: 'task-approve-1',
        },
        requires_confirmation: false,
        prompt_kind: 'none',
      },
      {
        action_id: 'task-approve-1:request_changes',
        kind: 'request_changes_task',
        label: 'Request changes',
        target: {
          target_kind: 'task',
          target_id: 'task-approve-1',
        },
        requires_confirmation: true,
        prompt_kind: 'feedback',
      },
      {
        action_id: 'task-approve-1:add-work',
        kind: 'add_work_item',
        label: 'Add / Modify Work',
        target: {
          target_kind: 'work_item',
          target_id: 'work-item-1',
        },
        requires_confirmation: false,
        prompt_kind: 'none',
      },
    ],
  } as DashboardWorkflowNeedsActionItem;
}
