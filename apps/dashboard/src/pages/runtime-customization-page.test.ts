import { describe, expect, it } from 'vitest';

import { buildDigestDiffRows } from './runtime-customization-form.js';
import { summarizeGates } from './runtime-customization-support.js';

describe('runtime customization digest review', () => {
  it('builds a current-versus-next digest table for link review', () => {
    const rows = buildDigestDiffRows({
      configuredDigest: 'sha256:build-1',
      activeDigest: 'sha256:base',
      pendingRolloutDigest: 'sha256:build-1',
      candidateDigest: 'sha256:build-2',
    });

    expect(rows).toEqual([
      { label: 'Configured', current: 'sha256:build-1', next: 'sha256:build-2' },
      { label: 'Active', current: 'sha256:base', next: 'sha256:build-2' },
      { label: 'Pending rollout', current: 'sha256:build-1', next: 'sha256:build-2' },
    ]);
  });
});

describe('runtime customization gate summary', () => {
  it('counts passed, failed, and blocked gates for the review panel', () => {
    const summary = summarizeGates({
      build_id: 'build-1',
      state: 'gated',
      manifest: {
        template: 'node',
        base_image: 'ghcr.io/agentbaton/runtime@sha256:1234',
      },
      link_ready: false,
      gates: [
        { name: 'determinism', status: 'passed' },
        { name: 'sbom', status: 'failed' },
        { name: 'signature', status: 'waiting' },
      ],
    });

    expect(summary).toEqual({ passed: 1, failed: 1, blocked: 1 });
  });
});
