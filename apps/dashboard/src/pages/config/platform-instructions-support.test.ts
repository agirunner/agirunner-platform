import { describe, expect, it } from 'vitest';

import type { DashboardPlatformInstructionVersionRecord } from '../../lib/api.js';
import {
  buildPlatformInstructionVersionLabel,
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
