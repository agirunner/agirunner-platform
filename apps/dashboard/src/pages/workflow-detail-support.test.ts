import { describe, expect, it } from 'vitest';

import {
  groupTasksByStage,
  readProjectMemoryEntries,
  readWorkflowRunSummary,
} from './workflow-detail-support.js';

describe('workflow detail workflow support', () => {
  it('groups tasks by explicit stage names and preserves unassigned tasks', () => {
    const groups = groupTasksByStage(
      [
        { id: 'a', title: 'Plan', state: 'completed', depends_on: [], stage_name: 'planning' },
        { id: 'b', title: 'Build', state: 'ready', depends_on: [], stage_name: 'build' },
        { id: 'c', title: 'Loose', state: 'ready', depends_on: [] },
      ],
      ['planning', 'build'],
    );

    expect(groups).toEqual([
      expect.objectContaining({ stageName: 'planning', tasks: [expect.objectContaining({ id: 'a' })] }),
      expect.objectContaining({ stageName: 'build', tasks: [expect.objectContaining({ id: 'b' })] }),
      expect.objectContaining({ stageName: 'unassigned', tasks: [expect.objectContaining({ id: 'c' })] }),
    ]);
  });

  it('reads run summary from workflow metadata', () => {
    const summary = readWorkflowRunSummary({
      metadata: {
        run_summary: {
          kind: 'run_summary',
          workflow_id: 'pipe-1',
        },
      },
    });

    expect(summary).toEqual({ kind: 'run_summary', workflow_id: 'pipe-1' });
  });

  it('reads project memory entries in sorted order', () => {
    expect(
      readProjectMemoryEntries({
        memory: {
          zeta: { value: 2 },
          alpha: { value: 1 },
        },
      }),
    ).toEqual([
      { key: 'alpha', value: { value: 1 } },
      { key: 'zeta', value: { value: 2 } },
    ]);
  });
});
