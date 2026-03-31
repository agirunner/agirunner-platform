import { describe, expect, it } from 'vitest';

import { shouldRetryDashboardQuery } from './dashboard-query-retry.js';

describe('shouldRetryDashboardQuery', () => {
  it('does not retry client-side 404 errors', () => {
    expect(shouldRetryDashboardQuery(0, new Error('HTTP 404: Workflow not found'))).toBe(false);
  });

  it('does not retry other client-side 400 errors', () => {
    expect(shouldRetryDashboardQuery(0, new Error('HTTP 400: Validation failed'))).toBe(false);
  });

  it('retries one transient server error once', () => {
    expect(shouldRetryDashboardQuery(0, new Error('HTTP 503: Service unavailable'))).toBe(true);
    expect(shouldRetryDashboardQuery(1, new Error('HTTP 503: Service unavailable'))).toBe(false);
  });

  it('does not retry auth failures', () => {
    expect(shouldRetryDashboardQuery(0, new Error('HTTP 401: Unauthorized'))).toBe(false);
  });

  it('retries non-http failures once', () => {
    expect(shouldRetryDashboardQuery(0, new Error('Network request failed'))).toBe(true);
    expect(shouldRetryDashboardQuery(1, new Error('Network request failed'))).toBe(false);
  });
});
