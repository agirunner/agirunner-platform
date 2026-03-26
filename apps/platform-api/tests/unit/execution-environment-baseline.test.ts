import { describe, expect, it } from 'vitest';

import {
  BASELINE_EXECUTION_ENVIRONMENT_COMMANDS,
  buildCatalogSeedVerification,
} from '../../src/services/execution-environment-baseline.js';

describe('execution environment baseline', () => {
  it('matches the runtime post-bootstrap command contract for seeded catalog environments', () => {
    expect(BASELINE_EXECUTION_ENVIRONMENT_COMMANDS).toEqual([
      'sleep',
      'sh',
      'cat',
      'mkdir',
      'mv',
      'chmod',
      'rm',
      'cp',
      'find',
      'sort',
      'awk',
      'sed',
      'grep',
      'head',
    ]);
  });

  it('marks seeded catalog verification with the runtime-aligned baseline commands', () => {
    const verification = buildCatalogSeedVerification({
      image: 'debian:13-slim',
      declared_metadata: {
        distro: 'debian',
        distro_version: '13',
        package_manager: 'apt-get',
      },
    });

    expect(verification.tool_capabilities.verified_baseline_commands).toEqual(
      BASELINE_EXECUTION_ENVIRONMENT_COMMANDS,
    );
    expect(verification.verified_metadata.probe_source).toBe('catalog_seed');
  });
});
