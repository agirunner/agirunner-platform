import { describe, expect, it } from 'vitest';

import { mapArtifactRow } from '../../../src/services/workspace-artifact-explorer/workspace-artifact-explorer-records.js';

describe('workspace-artifact-explorer-records', () => {
  it('redacts secret-like metadata while preserving preview metadata', () => {
    const result = mapArtifactRow({
      id: 'artifact-1',
      workflow_id: 'wf-1',
      task_id: 'task-1',
      logical_path: 'artifact:wf-1/release-notes.md',
      content_type: 'text/markdown',
      size_bytes: 2048,
      metadata: { audience: 'operators', api_key: 'plain-secret' },
      created_at: new Date('2026-03-12T11:00:00.000Z'),
      workflow_name: 'Release board',
      workflow_state: 'active',
      work_item_id: 'wi-1',
      work_item_title: 'Prepare release packet',
      stage_name: 'delivery',
      role: 'writer',
      task_title: 'Build release notes',
      task_state: 'completed',
    }, 1024 * 1024);

    expect(result.metadata).toEqual({
      audience: 'operators',
      api_key: 'redacted://artifact-metadata-secret',
    });
    expect(result.preview_eligible).toBe(true);
    expect(result.preview_mode).toBe('text');
  });
});
