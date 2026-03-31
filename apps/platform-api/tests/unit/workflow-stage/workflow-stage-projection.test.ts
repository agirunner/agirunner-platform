import { describe, expect, it } from 'vitest';

import { deriveWorkflowStageProjection } from '../../../src/services/workflow-stage-projection.js';

describe('deriveWorkflowStageProjection', () => {
  it('derives planned current and active stages from normalized stage rows', () => {
    const projection = deriveWorkflowStageProjection({
      lifecycle: 'planned',
      stageRows: [
        { name: 'design', position: 0, status: 'completed' },
        { name: 'implementation', position: 1, status: 'active' },
        { name: 'review', position: 2, status: 'awaiting_gate' },
      ],
      openWorkItemStageNames: ['implementation'],
    });

    expect(projection).toEqual({
      currentStage: 'implementation',
      activeStages: ['implementation', 'review'],
    });
  });

  it('keeps ongoing active stages work-item driven and omits workflow-global current stage', () => {
    const projection = deriveWorkflowStageProjection({
      lifecycle: 'ongoing',
      stageRows: [
        { name: 'triage', position: 0, status: 'active' },
        { name: 'review', position: 1, status: 'awaiting_gate' },
      ],
      openWorkItemStageNames: ['triage'],
    });

    expect(projection).toEqual({
      currentStage: null,
      activeStages: ['triage'],
    });
  });

  it('prefers planned open work item stages over stale active stage rows for current stage', () => {
    const projection = deriveWorkflowStageProjection({
      lifecycle: 'planned',
      stageRows: [
        { name: 'design', position: 0, status: 'active' },
        { name: 'implementation', position: 1, status: 'pending' },
      ],
      openWorkItemStageNames: ['implementation'],
    });

    expect(projection).toEqual({
      currentStage: 'implementation',
      activeStages: ['implementation'],
    });
  });
});
