import { describe, expect, it } from 'vitest';

import { workflowOperatorBriefs } from '../../src/db/schema/workflow-operator-briefs.js';
import { workflowOperatorUpdates } from '../../src/db/schema/workflow-operator-updates.js';

describe('workflow operator record schema', () => {
  it('stores request and execution context ids as text for live loop compatibility', () => {
    expect(workflowOperatorUpdates.requestId.getSQLType()).toBe('text');
    expect(workflowOperatorUpdates.executionContextId.getSQLType()).toBe('text');
    expect(workflowOperatorBriefs.requestId.getSQLType()).toBe('text');
    expect(workflowOperatorBriefs.executionContextId.getSQLType()).toBe('text');
  });
});
