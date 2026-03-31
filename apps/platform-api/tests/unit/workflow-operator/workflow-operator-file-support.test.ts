import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { buildWorkflowOperatorStorageKey } from '../../../src/services/workflow-operator/workflow-operator-file-support.js';

describe('buildWorkflowOperatorStorageKey', () => {
  it('builds workflow operator file keys under the workflow artifact namespace', () => {
    expect(
      buildWorkflowOperatorStorageKey({
        tenantId: 'tenant-1',
        workflowId: 'workflow-1',
        ownerPath: 'input-packets',
        ownerId: 'packet-1',
        fileId: 'file-1',
        fileName: 'brief.md',
      }),
    ).toBe('tenants/tenant-1/workflows/workflow-1/input-packets/packet-1/files/file-1/brief.md');
  });

  it('rejects unsafe storage path segments before persisting operator files', () => {
    expect(() =>
      buildWorkflowOperatorStorageKey({
        tenantId: '../tenant-1',
        workflowId: 'workflow-1',
        ownerPath: 'input-packets',
        ownerId: 'packet-1',
        fileId: 'file-1',
        fileName: 'brief.md',
      }),
    ).toThrow(ValidationError);
  });
});
