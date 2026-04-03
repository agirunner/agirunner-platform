import { describe, expect, it } from 'vitest';

import {
  describeRuntimeVersionLabel,
  shortenRevision,
} from './layout-version-summary.js';

const TEST_RELEASE_VERSION = '9.8.7-rc.1';

describe('layout version summary helpers', () => {
  it('shortens git revisions for compact sidebar display', () => {
    expect(shortenRevision('runtime-revision-demo')).toBe('runtime');
    expect(shortenRevision('unlabeled')).toBe('unlabeled');
    expect(shortenRevision('')).toBe('unlabeled');
  });

  it('prefers the reported runtime version over a moving image tag', () => {
    expect(
      describeRuntimeVersionLabel({
        image: 'ghcr.io/agirunner/agirunner-runtime:latest',
        image_digest: 'sha256:runtime',
        version: TEST_RELEASE_VERSION,
        revision: 'rev-runtime-alpha-1',
        total_containers: 1,
        orchestrator_containers: 1,
        specialist_runtime_containers: 0,
      }),
    ).toBe(TEST_RELEASE_VERSION);
  });
});
