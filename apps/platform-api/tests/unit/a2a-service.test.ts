import { describe, expect, it } from 'vitest';

import {
  buildA2ATaskResponse,
  buildA2AStreamEvent,
  mapA2ATaskToCreateInput,
} from '../../src/services/a2a-service.js';

describe('a2a service mapping', () => {
  it('maps inbound A2A task payloads onto the standard create-task input', () => {
    expect(
      mapA2ATaskToCreateInput({
        id: 'external-1',
        title: 'Review spec',
        type: 'review',
        capabilities: ['docs'],
        metadata: { source: 'a2a-client' },
      }),
    ).toEqual(
      expect.objectContaining({
        title: 'Review spec',
        capabilities_required: ['docs'],
        metadata: {
          source: 'a2a-client',
          protocol_ingress: {
            protocol: 'a2a',
            external_task_id: 'external-1',
          },
        },
      }),
    );
  });

  it('maps platform task states and events to A2A-facing status values', () => {
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'ready', metadata: {} }).status).toBe('submitted');
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'awaiting_approval', metadata: {} }).status).toBe('input-required');
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'completed', metadata: {}, output: { ok: true } }).status).toBe('completed');

    expect(
      buildA2AStreamEvent({
        id: 1,
        type: 'task.state_changed',
        entity_id: 'task-1',
        created_at: '2026-03-07T00:00:00.000Z',
        data: { to_state: 'running' },
      }).status,
    ).toBe('working');
  });
});
