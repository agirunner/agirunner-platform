import { describe, expect, it } from 'vitest';

import { TaskQueryService } from '../../../src/services/task/task-query-service.js';
import { createPool, taskId, tenantId } from './support.js';

describe('TaskQueryService task responses', () => {
  it('exposes verification payload from task metadata in normalized task response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      activation_id: 'activation-1',
      request_id: 'request-1',
      is_orchestrator_task: true,
      execution_backend: 'runtime_only',
      used_task_sandbox: false,
      metadata: {
        description: 'test task',
        verification: { passed: true, strategies_run: ['test_execution'] },
      },
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      work_item_id: 'work-item-1',
      stage_name: 'implementation',
      activation_id: 'activation-1',
      request_id: 'request-1',
      is_orchestrator_task: true,
      execution_backend: 'runtime_only',
      used_task_sandbox: false,
      metadata: {
        description: 'test task',
        verification: { passed: true, strategies_run: ['test_execution'] },
      },
    }) as any;

    expect(response.verification).toEqual({ passed: true, strategies_run: ['test_execution'] });
    expect(response.description).toBe('test task');
    expect(response.work_item_id).toBe('work-item-1');
    expect(response.stage_name).toBe('implementation');
    expect(response.activation_id).toBe('activation-1');
    expect(response.request_id).toBe('request-1');
    expect(response.is_orchestrator_task).toBe(true);
    expect(response.execution_backend).toBe('runtime_only');
    expect(response.used_task_sandbox).toBe(false);
  });

  it('normalizes execution environment snapshot fields into the public task response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
      execution_environment_snapshot: {
        id: 'env-default',
        name: 'Debian Base',
        image: 'debian:trixie-slim',
        verified_metadata: {
          distro: 'debian',
          distro_version: 'trixie',
        },
      },
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
      execution_environment_snapshot: {
        id: 'env-default',
        name: 'Debian Base',
        image: 'debian:trixie-slim',
        verified_metadata: {
          distro: 'debian',
          distro_version: 'trixie',
        },
      },
    }) as any;

    expect(response.execution_environment).toEqual(
      expect.objectContaining({
        id: 'env-default',
        name: 'Debian Base',
        image: 'debian:trixie-slim',
      }),
    );
  });

  it('keeps canonical persisted task states unchanged in the public response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'in_progress',
        metadata: {},
      }) as Record<string, unknown>,
    ).toEqual(expect.objectContaining({ state: 'in_progress' }));
  });

  it('rejects stale persisted task aliases instead of rewriting them in the public response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(() =>
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'running',
        metadata: {},
      }),
    ).toThrow("Persisted task state must be canonical. Found 'running'.");

    expect(() =>
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'awaiting_escalation',
        metadata: {},
      }),
    ).toThrow("Persisted task state must be canonical. Found 'awaiting_escalation'.");
  });

  it('keeps canonical escalated task state unchanged in the public response', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      metadata: {},
    }) as never);

    expect(
      service.toTaskResponse({
        id: taskId,
        tenant_id: tenantId,
        state: 'escalated',
        metadata: {},
      }) as Record<string, unknown>,
    ).toEqual(expect.objectContaining({ state: 'escalated' }));
  });

  it('redacts plaintext secrets and secret refs from task API responses', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      input: {
        credentials: {
          git_token: 'plaintext-token',
          git_token_ref: 'secret:GIT_TOKEN',
        },
      },
      role_config: {
        llm_api_key: 'plaintext-api-key',
        llm_model: 'gpt-5',
      },
      resource_bindings: [
        {
          type: 'git_repository',
          credentials: {
            ssh_private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n',
            secret_ref: 'secret:GIT_SSH_KEY',
          },
        },
      ],
      metadata: {},
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      input: {
        credentials: {
          git_token: 'plaintext-token',
          git_token_ref: 'secret:GIT_TOKEN',
        },
      },
      role_config: {
        llm_api_key: 'plaintext-api-key',
        llm_model: 'gpt-5',
      },
      resource_bindings: [
        {
          type: 'git_repository',
          credentials: {
            ssh_private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n',
            secret_ref: 'secret:GIT_SSH_KEY',
          },
        },
      ],
      metadata: {},
    }) as Record<string, any>;

    expect(response.input.credentials.git_token).toBe('redacted://task-secret');
    expect(response.input.credentials.git_token_ref).toBe('redacted://task-secret');
    expect(response.role_config.llm_api_key).toBe('redacted://task-secret');
    expect(response.resource_bindings[0].credentials.ssh_private_key).toBe('redacted://task-secret');
    expect(response.resource_bindings[0].credentials.secret_ref).toBe('redacted://task-secret');
  });

  it('preserves dotted workflow event titles in task API responses', () => {
    const service = new TaskQueryService(createPool({
      id: taskId,
      tenant_id: tenantId,
      title: 'Orchestrate SDLC Lite Approval Rework: stage.gate.request_changes',
      metadata: {},
    }) as never);

    const response = service.toTaskResponse({
      id: taskId,
      tenant_id: tenantId,
      title: 'Orchestrate SDLC Lite Approval Rework: stage.gate.request_changes',
      metadata: {},
    }) as Record<string, unknown>;

    expect(response.title).toBe('Orchestrate SDLC Lite Approval Rework: stage.gate.request_changes');
  });
});
