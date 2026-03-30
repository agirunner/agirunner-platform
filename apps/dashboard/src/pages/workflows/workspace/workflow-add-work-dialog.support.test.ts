import { describe, expect, it } from 'vitest';

import {
  buildInitialWorkItemInputDrafts,
  buildWorkItemInputDraftsFromStructuredInputs,
} from './workflow-add-work-dialog.support.js';

describe('workflow-add-work-dialog support', () => {
  it('prefills repeat mode from the latest packet attached to the source work item', () => {
    const drafts = buildInitialWorkItemInputDrafts({
      mode: 'repeat',
      sourceWorkItemId: 'work-item-1',
      inputPackets: [
        {
          work_item_id: 'work-item-1',
          created_at: '2026-03-30T10:00:00.000Z',
          structured_inputs: {
            audience: 'Operators',
          },
        },
        {
          work_item_id: 'work-item-1',
          created_at: '2026-03-30T12:00:00.000Z',
          structured_inputs: {
            audience: 'Release managers',
            summary: 'Carry forward the release-risk narrative.',
          },
        },
      ],
    });

    expect(
      drafts.map((draft) => ({
        key: draft.key,
        value: draft.value,
      })),
    ).toEqual([
      {
        key: 'audience',
        value: 'Release managers',
      },
      {
        key: 'summary',
        value: 'Carry forward the release-risk narrative.',
      },
    ]);
  });

  it('ignores unrelated packets and leaves add-work mode empty', () => {
    const drafts = buildInitialWorkItemInputDrafts({
      mode: 'create',
      sourceWorkItemId: 'work-item-1',
      inputPackets: [
        {
          work_item_id: 'other-work-item',
          created_at: '2026-03-30T12:00:00.000Z',
          structured_inputs: {
            audience: 'Ignore me',
          },
        },
      ],
    });

    expect(drafts).toEqual([]);
  });

  it('normalizes structured inputs into editable string drafts', () => {
    const drafts = buildWorkItemInputDraftsFromStructuredInputs({
      audience: 'Release managers',
      attempts: 3,
      approved: false,
      payload: {
        phase: 'review',
      },
    });

    expect(
      drafts.map((draft) => ({
        key: draft.key,
        value: draft.value,
      })),
    ).toEqual([
      { key: 'approved', value: 'false' },
      { key: 'attempts', value: '3' },
      { key: 'audience', value: 'Release managers' },
      { key: 'payload', value: '{"phase":"review"}' },
    ]);
  });
});
