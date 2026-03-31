import { describe, expect, it } from 'vitest';

import { serializeSafetynetCatalog } from '../../../src/services/safetynet/catalog.js';
import { listSafetynetEntries } from '../../../src/services/safetynet/registry.js';

describe('platform safetynet catalog export', () => {
  it('serializes the registered entries with design field names', () => {
    const payload = serializeSafetynetCatalog();
    const decoded = JSON.parse(payload) as Array<Record<string, unknown>>;

    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded[0]).toHaveProperty('kind');
    expect(decoded[0]).toHaveProperty('id');
    expect(decoded[0]).toHaveProperty('metrics_key');
    expect(decoded[0]).toHaveProperty('log_event_type');
    expect(decoded[0]).not.toHaveProperty('metricsKey');
    expect(decoded[0]).not.toHaveProperty('logEventType');
  });

  it('serializes the current registry inventory without dropping entries', () => {
    const payload = serializeSafetynetCatalog();
    const decoded = JSON.parse(payload);

    expect(decoded).toEqual(listSafetynetEntries());
  });
});
