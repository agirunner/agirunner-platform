import { describe, expect, it } from 'vitest';

import { describeProjectMemoryEntry } from './workflow-detail-content-support.js';

describe('workflow detail content support', () => {
  it('summarizes structured memory entries into operator-friendly packets', () => {
    expect(
      describeProjectMemoryEntry({
        summary: 'Auth migration ready',
        risks: ['token rotation', 'session invalidation'],
        handoff: { owner: 'platform', nextStep: 'schedule rollout' },
      }),
    ).toEqual({
      typeLabel: 'Structured',
      summary: '3 fields captured',
      detail: '2 nested sections available for drill-down.',
      badges: ['Summary', 'Risks', 'Handoff'],
      hasStructuredDetail: true,
    });
  });

  it('summarizes scalar and list memory entries without forcing raw record views', () => {
    expect(describeProjectMemoryEntry('Need approval from security before rollout.')).toEqual({
      typeLabel: 'Text',
      summary: 'Need approval from security before rollout.',
      detail: '43 characters of reusable operator context.',
      badges: [],
      hasStructuredDetail: false,
    });

    expect(
      describeProjectMemoryEntry(['credential audit', 'git fixture sync', 'smoke replay']),
    ).toEqual({
      typeLabel: 'List',
      summary: '3 items recorded',
      detail: 'Includes credential audit, git fixture sync, smoke replay.',
      badges: ['credential audit', 'git fixture sync', 'smoke replay'],
      hasStructuredDetail: true,
    });
  });
});
