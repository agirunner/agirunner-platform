import { describe, expect, it } from 'vitest';

import type { DashboardPlatformInstructionVersionRecord } from '../../lib/api.js';
import {
  buildPlatformInstructionVersionLabel,
  buildPlatformInstructionDraftStatus,
  buildPlatformInstructionSummaryCards,
  chooseComparedPlatformInstructionVersion,
  renderPlatformInstructionSnapshot,
} from './platform-instructions-support.js';

describe('platform instructions support', () => {
  it('chooses the newest older version for comparison when the current version exists', () => {
    const versions = [createVersion(7), createVersion(6), createVersion(5)];

    const compared = chooseComparedPlatformInstructionVersion(versions, 7);

    expect(compared?.version).toBe(6);
  });

  it('labels current versions and renders persisted snapshots', () => {
    const version = createVersion(4);

    expect(buildPlatformInstructionVersionLabel(version, 4)).toContain('current');
    expect(renderPlatformInstructionSnapshot(version)).toContain('Version: v4');
    expect(renderPlatformInstructionSnapshot(version)).toContain('Updated by: admin:key_123');
  });

  it('summarizes baseline posture and draft status for operators', () => {
    const current = {
      id: 'instruction-current',
      version: 7,
      content: '# Platform\nCurrent baseline',
      format: 'markdown' as const,
      updated_at: '2026-03-12T10:30:00.000Z',
      updated_by_type: 'admin',
      updated_by_id: 'key_123',
    };
    const versions = [createVersion(7), createVersion(6), createVersion(5)];

    expect(
      buildPlatformInstructionSummaryCards(current, versions, '# Draft\nneeds review', true),
    ).toEqual([
      {
        label: 'Active baseline',
        value: 'v7',
        detail: expect.stringContaining('Last saved'),
      },
      {
        label: 'History depth',
        value: '3 saved versions',
        detail: '2 restore points available beyond the live version.',
      },
      {
        label: 'Draft posture',
        value: 'Unsaved changes',
        detail: '4 words across 2 lines.',
      },
    ]);

    expect(
      buildPlatformInstructionDraftStatus(current, '', true),
    ).toEqual({
      tone: 'warning',
      title: 'Draft will clear the live baseline.',
      detail: 'Save only when you intentionally want an empty platform-instructions version.',
    });
  });
});

function createVersion(version: number): DashboardPlatformInstructionVersionRecord {
  return {
    id: `instruction-version-${version}`,
    version,
    content: `# Platform\nversion ${version}`,
    format: 'markdown',
    created_at: '2026-03-12T10:30:00.000Z',
    created_by_type: 'admin',
    created_by_id: 'key_123',
  };
}
