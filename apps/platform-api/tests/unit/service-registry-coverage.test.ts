import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SERVICE_REGISTRY } from '../../src/logging/service-registry.js';

function readWrappedServiceNames() {
  const appBootstrap = readFileSync(
    new URL('../../src/bootstrap/app.ts', import.meta.url),
    'utf8',
  );

  return Array.from(
    new Set(
      Array.from(appBootstrap.matchAll(/createLoggedService\([^,]+,\s*'([^']+)'/g), (match) => match[1]),
    ),
  ).sort();
}

describe('SERVICE_REGISTRY coverage', () => {
  it('coversEveryWrappedService', () => {
    const wrappedServices = readWrappedServiceNames();
    const registryServices = Object.keys(SERVICE_REGISTRY).sort();

    expect(registryServices).toEqual(wrappedServices);
  });
});
