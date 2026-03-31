import { describe, expect, it } from 'vitest';

import { collectTerminatedBranchIds } from '../../../src/services/workflow-branch-service.js';

describe('workflow-branch-service', () => {
  const branches = [
    { id: 'root-a', parent_branch_id: null },
    { id: 'child-a1', parent_branch_id: 'root-a' },
    { id: 'child-a2', parent_branch_id: 'root-a' },
    { id: 'grandchild-a2-1', parent_branch_id: 'child-a2' },
    { id: 'root-b', parent_branch_id: null },
  ];

  it('targets only the selected branch for stop_branch_only', () => {
    expect(collectTerminatedBranchIds(branches, 'child-a2', 'stop_branch_only')).toEqual(['child-a2']);
  });

  it('targets the selected branch and descendants for stop_branch_and_descendants', () => {
    expect(collectTerminatedBranchIds(branches, 'child-a2', 'stop_branch_and_descendants')).toEqual([
      'child-a2',
      'grandchild-a2-1',
    ]);
  });

  it('targets sibling branches and their descendants for stop_all_siblings', () => {
    expect(collectTerminatedBranchIds(branches, 'child-a2', 'stop_all_siblings')).toEqual([
      'child-a1',
      'child-a2',
      'grandchild-a2-1',
    ]);
  });
});
