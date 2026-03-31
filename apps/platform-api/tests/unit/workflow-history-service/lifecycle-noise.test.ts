import { describe, expect, it, vi } from 'vitest';

import { createWorkflowHistoryService, createVersionSource } from './support.js';

describe('WorkflowHistoryService lifecycle noise suppression', () => {
  it('does not leak lifecycle logs into the primary history stream when milestone briefs are absent', async () => {
    const { service } = createWorkflowHistoryService();

    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([]);
  });

  it('stays empty when only lifecycle logs exist and no history packets were published', async () => {
    const { service } = createWorkflowHistoryService({
      versionSource: createVersionSource(),
    });

    const result = await service.getHistory('tenant-1', 'workflow-1', { limit: 10 });

    expect(result.items).toEqual([]);
  });
});
