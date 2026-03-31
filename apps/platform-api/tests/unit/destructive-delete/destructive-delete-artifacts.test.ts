import { describe, expect, it, vi } from 'vitest';

import { deleteStoredArtifacts } from '../../../src/services/destructive-delete/destructive-delete-artifacts.js';

describe('destructive-delete-artifacts', () => {
  it('deduplicates storage keys before deleting backing objects', async () => {
    const storage = { deleteObject: vi.fn().mockResolvedValue(undefined) };
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { storage_key: 'tenant-1/workflow-1/report.md' },
          { storage_key: 'tenant-1/workflow-1/report.md' },
          { storage_key: 'tenant-1/workflow-1/log.txt' },
        ],
      }),
    };

    await deleteStoredArtifacts(db, storage, 'SELECT storage_key FROM workflow_artifacts', ['tenant-1']);

    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenNthCalledWith(1, 'tenant-1/workflow-1/report.md');
    expect(storage.deleteObject).toHaveBeenNthCalledWith(2, 'tenant-1/workflow-1/log.txt');
  });
});
