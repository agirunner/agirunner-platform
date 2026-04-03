import { describe, expect, it } from 'vitest';

import {
  describeRuntimeVersionLabel,
  describeRuntimeVersionGroup,
  shortenRevision,
} from './layout-version-summary.js';

describe('layout version summary helpers', () => {
  it('shortens git revisions for compact sidebar display', () => {
    expect(shortenRevision('runtime-revision-demo')).toBe('runtime');
    expect(shortenRevision('unlabeled')).toBe('unlabeled');
    expect(shortenRevision('')).toBe('unlabeled');
  });

  it('describes grouped runtime counts in compact prose', () => {
    expect(
      describeRuntimeVersionGroup({
        image: 'ghcr.io/agirunner/agirunner-runtime:0.1.0-rc.1',
        image_digest: 'sha256:runtime',
        version: '0.1.0-rc.1',
        revision: 'rev-runtime-123456',
        total_containers: 3,
        orchestrator_containers: 1,
        specialist_runtime_containers: 2,
      }),
    ).toBe('3 containers | 1 orchestrator | 2 specialist runtimes');
  });

  it('prefers the reported runtime version over a moving image tag', () => {
    expect(
      describeRuntimeVersionLabel({
        image: 'ghcr.io/agirunner/agirunner-runtime:latest',
        image_digest: 'sha256:runtime',
        version: '0.1.0-alpha.1',
        revision: 'rev-runtime-alpha-1',
        total_containers: 1,
        orchestrator_containers: 1,
        specialist_runtime_containers: 0,
      }),
    ).toBe('0.1.0-alpha.1');
  });
});
