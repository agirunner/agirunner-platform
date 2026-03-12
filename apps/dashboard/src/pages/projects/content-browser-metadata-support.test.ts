import { describe, expect, it } from 'vitest';

import {
  buildMetadataRecord,
  createMetadataDraft,
  createMetadataDraftsFromRecord,
  updateMetadataDraft,
} from './content-browser-metadata-support.js';

describe('content browser metadata support', () => {
  it('hydrates structured metadata drafts from existing records', () => {
    const drafts = createMetadataDraftsFromRecord({
      owner: 'ops',
      attempts: 3,
      approved: true,
      context: { stage: 'review' },
    });

    expect(drafts.map((draft) => draft.valueType)).toEqual(['string', 'number', 'boolean', 'json']);
  });

  it('builds typed metadata records from structured drafts', () => {
    const base = createMetadataDraft();
    const drafts = [
      updateMetadataDraft([base], base.id, { key: 'owner', valueType: 'string', value: 'ops' })[0],
      createMetadataDraft('number'),
      createMetadataDraft('boolean'),
      createMetadataDraft('json'),
    ];
    const completedDrafts = [
      drafts[0],
      updateMetadataDraft(drafts, drafts[1].id, { key: 'attempts', value: '2' }).find((draft) => draft.id === drafts[1].id)!,
      updateMetadataDraft(drafts, drafts[2].id, { key: 'approved', value: 'false' }).find((draft) => draft.id === drafts[2].id)!,
      updateMetadataDraft(drafts, drafts[3].id, { key: 'context', value: '{"stage":"review"}' }).find((draft) => draft.id === drafts[3].id)!,
    ];

    expect(buildMetadataRecord(completedDrafts)).toEqual({
      value: {
        owner: 'ops',
        attempts: 2,
        approved: false,
        context: { stage: 'review' },
      },
      error: null,
    });
  });

  it('rejects duplicate keys and malformed JSON metadata', () => {
    const first = createMetadataDraft();
    const second = createMetadataDraft('json');
    const duplicateDrafts = [
      updateMetadataDraft([first], first.id, { key: 'owner', value: 'ops' })[0],
      updateMetadataDraft([second], second.id, { key: 'owner', value: '{"bad":true}' })[0],
    ];
    expect(buildMetadataRecord(duplicateDrafts)).toEqual({
      value: null,
      error: 'Duplicate metadata key "owner".',
    });

    const invalidJson = updateMetadataDraft([second], second.id, {
      key: 'context',
      value: '{bad}',
    });
    expect(buildMetadataRecord(invalidJson)).toEqual({
      value: null,
      error: 'Metadata value for "context" must be valid JSON.',
    });
  });
});
