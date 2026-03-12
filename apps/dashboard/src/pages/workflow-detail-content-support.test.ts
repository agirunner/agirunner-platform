import { describe, expect, it } from 'vitest';

import { describeDocumentReference, describeProjectMemoryEntry } from './workflow-detail-content-support.js';

describe('workflow detail content support', () => {
  it('describes document references as operator review packets', () => {
    expect(
      describeDocumentReference({
        logical_name: 'design-brief',
        scope: 'workflow',
        source: 'repository',
        description: 'Architecture brief for the active stage.',
        metadata: { owner: 'architect' },
        repository: 'github.com/agisnap/agirunner',
        path: 'docs/design.md',
      }),
    ).toEqual({
      summary: 'docs/design.md',
      detail: 'Architecture brief for the active stage.',
      badges: ['Repository', 'Workflow'],
      locationLabel: 'github.com/agisnap/agirunner:docs/design.md',
      hasMetadata: true,
    });
  });

  it('describes structured project memory with drill-down badges', () => {
    expect(
      describeProjectMemoryEntry({
        summary: 'Ready for operator handoff',
        stage: 'verification',
        follow_up: { owner: 'reviewer' },
      }),
    ).toEqual({
      typeLabel: 'Structured',
      summary: '3 fields captured',
      detail: '1 nested section available for drill-down.',
      badges: ['Summary', 'Stage', 'Follow Up'],
      hasStructuredDetail: true,
    });
  });
});
