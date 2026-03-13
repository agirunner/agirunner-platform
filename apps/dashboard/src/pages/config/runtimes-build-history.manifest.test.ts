import { describe, expect, it } from 'vitest';

import {
  buildRuntimeManifestPackets,
  formatManifestJson,
} from './runtimes-build-history.manifest.js';

describe('runtime manifest support', () => {
  it('builds operator-readable manifest packets from runtime customization data', () => {
    const packets = buildRuntimeManifestPackets({
      template: 'python',
      base_image: 'ghcr.io/agisnap/runtime:2026.03',
      customizations: {
        apt: ['git', 'ripgrep'],
        npm_global: ['pnpm'],
        pip: ['pytest'],
        files: [{ source: 'fixtures/tooling.toml', target: '/workspace/tooling.toml' }],
        setup_script: { path: 'scripts/bootstrap.sh', sha256: 'sha256:abc123' },
      },
      reasoning: {
        orchestrator_level: 'medium',
        internal_workers_level: 'high',
      },
    });

    expect(packets).toEqual([
      {
        label: 'Base image',
        value: 'ghcr.io/agisnap/runtime:2026.03',
        detail: 'Runtime preset python anchors the current runtime manifest.',
      },
      {
        label: 'System packages',
        value: '4',
        detail: '2 apt • 1 npm global • 1 pip package changes are recorded.',
      },
      {
        label: 'Managed files',
        value: '1',
        detail: 'Managed files and path mapping are present in this manifest packet.',
      },
      {
        label: 'Setup path',
        value: 'scripts/bootstrap.sh',
        detail: 'A setup script is part of the runtime handoff.',
      },
      {
        label: 'Reasoning levels',
        value: 'Orchestrator medium • Specialists high',
        detail: 'Resolved orchestrator and specialist reasoning posture for this runtime image.',
      },
    ]);
  });

  it('formats raw manifest json for disclosure', () => {
    expect(
      formatManifestJson({
        template: 'node',
        base_image: 'node:22',
      }),
    ).toContain('"base_image": "node:22"');
  });
});
