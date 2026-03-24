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
        type: 'assessment',
        metadata: { source: 'a2a-client' },
      }),
    ).toEqual(
      expect.objectContaining({
        title: 'Review spec',
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

  it('ignores legacy governance flags on inbound A2A task payloads', () => {
    const input = mapA2ATaskToCreateInput({
      id: 'external-legacy',
      title: 'Legacy ingress',
      requires_approval: true,
    } as never);

    expect(input).not.toHaveProperty('requires_approval');
    expect(input.metadata).toEqual(
      expect.objectContaining({
        protocol_ingress: {
          protocol: 'a2a',
          external_task_id: 'external-legacy',
        },
      }),
    );
  });

  it('maps platform task states and events to A2A-facing status values', () => {
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'ready', metadata: {} }).status).toBe('submitted');
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'awaiting_approval', metadata: {} }).status).toBe('input-required');
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'escalated', metadata: {} }).status).toBe('input-required');
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'in_progress', metadata: {} }).status).toBe('working');
    expect(buildA2ATaskResponse({ id: 'task-1', state: 'completed', metadata: {}, output: { ok: true } }).status).toBe('completed');

    expect(
      buildA2AStreamEvent({
        id: 1,
        type: 'task.state_changed',
        entity_id: 'task-1',
        created_at: '2026-03-07T00:00:00.000Z',
        data: { to_state: 'in_progress' },
      }).status,
    ).toBe('working');
    expect(
      buildA2AStreamEvent({
        id: 2,
        type: 'task.state_changed',
        entity_id: 'task-1',
        created_at: '2026-03-07T00:00:01.000Z',
        data: { to_state: 'escalated' },
      }).status,
    ).toBe('input-required');
  });

  it('redacts secret-bearing task results and event payloads', () => {
    expect(
      buildA2ATaskResponse({
        id: 'task-1',
        state: 'completed',
        metadata: {
          protocol_ingress: {
            protocol: 'a2a',
            external_task_id: 'external-1',
            secret_ref: 'secret:SAFE_REF',
          },
        },
        output: {
          api_key: 'sk-live-secret',
          nested: {
            authorization: 'Bearer header.payload.signature',
            secret_ref: 'secret:SAFE_REF',
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        result: {
          api_key: 'redacted://a2a-secret',
          nested: {
            authorization: 'redacted://a2a-secret',
            secret_ref: 'redacted://a2a-secret',
          },
        },
        metadata: expect.objectContaining({
          protocol_ingress: {
            protocol: 'a2a',
            external_task_id: 'external-1',
            secret_ref: 'redacted://a2a-secret',
          },
        }),
      }),
    );

    expect(
      buildA2AStreamEvent({
        id: 3,
        type: 'task.completed',
        entity_id: 'task-1',
        created_at: '2026-03-07T00:00:02.000Z',
        data: {
          access_token: 'plaintext-access-token',
          nested: {
            password: 'hunter2',
            token_ref: 'secret:SAFE_REF',
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        data: {
          access_token: 'redacted://a2a-secret',
          nested: {
            password: 'redacted://a2a-secret',
            token_ref: 'redacted://a2a-secret',
          },
        },
      }),
    );
  });
});
