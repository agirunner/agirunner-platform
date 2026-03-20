import { describe, expect, it } from 'vitest';

import {
  assertValidContainerCpu,
  assertValidContainerImage,
  assertValidContainerMemory,
} from '../../src/services/container-resource-validation.js';

describe('container resource validation', () => {
  it('accepts standard image refs', () => {
    expect(() => assertValidContainerImage('ghcr.io/agirunner/runtime:v1.4.2', 'runtime image')).not.toThrow();
    expect(() =>
      assertValidContainerImage(
        'ghcr.io/agirunner/runtime@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        'runtime image',
      ),
    ).not.toThrow();
  });

  it('rejects malformed image, cpu, and memory values', () => {
    expect(() => assertValidContainerImage('https://ghcr.io/agirunner/runtime latest', 'runtime image')).toThrow(
      'valid container image reference',
    );
    expect(() => assertValidContainerCpu('zero', 'cpu')).toThrow('positive number');
    expect(() => assertValidContainerMemory('banana', 'memory')).toThrow('512m, 2g, or 2Gi');
    expect(() => assertValidContainerMemory('1', 'memory')).toThrow('512m, 2g, or 2Gi');
  });

  it('accepts memory values with explicit units', () => {
    expect(() => assertValidContainerMemory('1Gi', 'memory')).not.toThrow();
    expect(() => assertValidContainerMemory('1G', 'memory')).not.toThrow();
  });
});
