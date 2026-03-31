import { describe, expect, it, vi } from 'vitest';

import {
  buildHttpErrorMessage,
  buildMissionControlQuery,
  buildQueryString,
  buildRequestBodyWithRequestId,
  readContentDispositionFileName,
  resolvePlatformPath,
} from './create-dashboard-api.request.js';

describe('create dashboard api request helpers', () => {
  it('renders query strings while omitting blank values', () => {
    expect(buildQueryString({ mode: 'live', empty: '', missing: '' })).toBe('?mode=live');
    expect(
      buildMissionControlQuery({
        mode: 'history',
        limit: 20,
        workflow_id: '',
      }),
    ).toBe('?mode=history&limit=20');
  });

  it('keeps an existing request id and generates one when missing', () => {
    expect(buildRequestBodyWithRequestId({ request_id: 'request-123', action: 'approve' })).toEqual(
      {
        request_id: 'request-123',
        action: 'approve',
      },
    );

    const randomUuid = vi.fn(() => 'generated-request-id');
    vi.stubGlobal('crypto', { randomUUID: randomUuid });
    expect(buildRequestBodyWithRequestId({ action: 'approve' })).toEqual({
      request_id: 'generated-request-id',
      action: 'approve',
    });
  });

  it('surfaces validation details from JSON error responses', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: 'Invalid request body',
          details: {
            issues: {
              fieldErrors: {
                cadence_minutes: ['cadence_minutes is required for interval schedules'],
              },
              formErrors: [],
            },
          },
        },
      }),
      { status: 422, headers: { 'content-type': 'application/json' } },
    );

    await expect(buildHttpErrorMessage(response)).resolves.toBe(
      'HTTP 422: Invalid request body (cadence_minutes is required for interval schedules)',
    );
  });

  it('reads content-disposition filenames and keeps binary access on the api origin', () => {
    expect(readContentDispositionFileName("attachment; filename*=UTF-8''summary%20brief.md")).toBe(
      'summary brief.md',
    );
    expect(
      resolvePlatformPath('/api/v1/tasks/task-1/artifacts/artifact-1', 'http://platform.test'),
    ).toBe('http://platform.test/api/v1/tasks/task-1/artifacts/artifact-1');
    expect(() =>
      resolvePlatformPath('https://elsewhere.test/file.txt', 'http://platform.test'),
    ).toThrow('Artifact access must remain on the platform API origin');
  });
});
