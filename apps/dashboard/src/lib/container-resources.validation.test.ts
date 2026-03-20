import { describe, expect, it } from 'vitest';

import {
  validateContainerCpu,
  validateContainerImage,
  validateContainerMemory,
} from './container-resources.validation.js';

describe('container resources validation', () => {
  it('accepts standard image refs with tags, registry ports, and digests', () => {
    expect(validateContainerImage('ghcr.io/agirunner/runtime:v1.4.2', 'Runtime image')).toBeNull();
    expect(validateContainerImage('registry.example.com:5000/team/runtime:v1.4.2', 'Runtime image')).toBeNull();
    expect(
      validateContainerImage(
        'ghcr.io/agirunner/runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'Runtime image',
      ),
    ).toBeNull();
  });

  it('rejects malformed image refs', () => {
    expect(validateContainerImage('https://ghcr.io/agirunner/runtime:latest', 'Runtime image')).toContain(
      'valid container image reference',
    );
    expect(validateContainerImage('ghcr.io/agirunner/runtime latest', 'Runtime image')).toContain(
      'valid container image reference',
    );
  });

  it('rejects invalid cpu and memory values', () => {
    expect(validateContainerCpu('zero', 'CPU limit')).toContain('positive number');
    expect(validateContainerCpu('0', 'CPU limit')).toContain('greater than 0');
    expect(validateContainerMemory('banana', 'Memory limit')).toContain('512m, 2g, or 2Gi');
    expect(validateContainerMemory('0Gi', 'Memory limit')).toContain('greater than 0');
  });
});
