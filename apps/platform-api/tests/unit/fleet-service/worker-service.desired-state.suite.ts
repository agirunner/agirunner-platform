import { beforeEach, describe, expect, it } from 'vitest';

import { FleetService } from '../../../src/services/fleet-service.js';
import {
  createMockPool,
  sampleActiveTaskState,
  sampleActualState,
  sampleDesiredState,
  sampleDesiredStateWithSecrets,
  TENANT_ID,
  WORKER_ID,
} from './support.js';

describe('FleetService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: FleetService;

  beforeEach(() => {
    pool = createMockPool();
    service = new FleetService(pool as never);
  });

  describe('listWorkers', () => {
    it('returns workers with actual state', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].worker_name).toBe('test-worker');
      expect(result[0].actual).toEqual([sampleActualState]);
      expect(pool.query).toHaveBeenCalledTimes(3);
      expect((pool.query.mock.calls[1]?.[0] as string)).toContain('WHERE desired_state_id = ANY($1::uuid[])');
    });

    it('filters to enabled workers when requested', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.listWorkers(TENANT_ID, { enabledOnly: true });

      expect(result).toHaveLength(1);
      expect((pool.query.mock.calls[0]?.[0] as string)).toContain('tenant_id = $1 AND enabled = $2');
      expect(pool.query.mock.calls[0]?.[1]).toEqual([TENANT_ID, true]);
    });

    it('returns empty array when no workers exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result).toEqual([]);
    });

    it('redacts secret-bearing environment values and secret refs in worker reads', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredStateWithSecrets], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result[0]).not.toHaveProperty('llm_api_key_secret_ref');
      expect(result[0]?.llm_api_key_secret_ref_configured).toBe(true);
      expect(result[0]?.environment).toEqual({
        SAFE_NAME: 'worker-a',
        API_TOKEN: 'redacted://fleet-environment-secret',
        opaque: 'redacted://fleet-environment-secret',
        secrets_bundle: {
          username: 'redacted://fleet-environment-secret',
        },
        nested: {
          authorization: 'redacted://fleet-environment-secret',
          keep_ref: 'redacted://fleet-environment-secret',
        },
      });
    });

    it('batches actual-state lookup for multiple workers', async () => {
      const secondWorker = {
        ...sampleDesiredState,
        id: '00000000-0000-0000-0000-000000000100',
        worker_name: 'test-worker-2',
      };
      const secondActualState = {
        ...sampleActualState,
        id: '00000000-0000-0000-0000-000000000051',
        desired_state_id: secondWorker.id,
        container_id: 'def456',
      };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState, secondWorker], rowCount: 2 })
        .mockResolvedValueOnce({ rows: [sampleActualState, secondActualState], rowCount: 2 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result).toHaveLength(2);
      expect(result[0].actual).toEqual([sampleActualState]);
      expect(result[1].actual).toEqual([secondActualState]);
      expect(pool.query).toHaveBeenCalledTimes(3);
    });

    it('includes active task context for desired-state containers that are executing work', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActiveTaskState], rowCount: 1 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result[0]?.active_task_id).toBe(sampleActiveTaskState.active_task_id);
    });
  });

  describe('getWorker', () => {
    it('returns worker with actual state', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getWorker(TENANT_ID, WORKER_ID);

      expect(result.id).toBe(WORKER_ID);
      expect(result.actual).toEqual([sampleActualState]);
    });

    it('does not expose llm api key secret refs on single-worker reads', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredStateWithSecrets], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getWorker(TENANT_ID, WORKER_ID);

      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      expect(result.llm_api_key_secret_ref_configured).toBe(true);
      expect(result.environment).toEqual({
        SAFE_NAME: 'worker-a',
        API_TOKEN: 'redacted://fleet-environment-secret',
        opaque: 'redacted://fleet-environment-secret',
        secrets_bundle: {
          username: 'redacted://fleet-environment-secret',
        },
        nested: {
          authorization: 'redacted://fleet-environment-secret',
          keep_ref: 'redacted://fleet-environment-secret',
        },
      });
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.getWorker(TENANT_ID, 'missing')).rejects.toThrow('Fleet worker not found');
    });
  });

  describe('createWorker', () => {
    it('creates a new desired state entry', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDesiredStateWithSecrets], rowCount: 1 });

      const result = await service.createWorker(TENANT_ID, {
        workerName: 'test-worker',
        role: 'developer',
        poolKind: 'orchestrator',
        runtimeImage: 'agirunner-runtime:latest',
        cpuLimit: '2',
        memoryLimit: '2g',
        networkPolicy: 'restricted',
        environment: {
          SAFE_NAME: 'worker-a',
          API_TOKEN: 'secret:OPENAI_RUNTIME_TOKEN',
          nested: {
            authorization: 'secret:RUNTIME_AUTHORIZATION',
            keep_ref: 'secret:RUNTIME_KEY',
          },
        },
        llmApiKeySecretRef: 'secret:OPENAI_API_KEY',
        replicas: 1,
        enabled: true,
      });

      expect(result.worker_name).toBe('test-worker');
      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      expect(result.llm_api_key_secret_ref_configured).toBe(true);
      expect(result.environment).toEqual({
        SAFE_NAME: 'worker-a',
        API_TOKEN: 'redacted://fleet-environment-secret',
        opaque: 'redacted://fleet-environment-secret',
        secrets_bundle: {
          username: 'redacted://fleet-environment-secret',
        },
        nested: {
          authorization: 'redacted://fleet-environment-secret',
          keep_ref: 'redacted://fleet-environment-secret',
        },
      });
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('orchestrator');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO worker_desired_state');
    });

    it('applies orchestrator-specific cpu and memory defaults when omitted', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDesiredStateWithSecrets], rowCount: 1 });

      await service.createWorker(TENANT_ID, {
        workerName: 'orchestrator-primary',
        role: 'orchestrator',
        poolKind: 'orchestrator',
        runtimeImage: 'agirunner-runtime:latest',
        networkPolicy: 'restricted',
        environment: {},
        replicas: 1,
        enabled: true,
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('2');
      expect(params).toContain('256m');
    });

    it('rejects plaintext llm api keys in desired state writes', async () => {
      await expect(
        service.createWorker(TENANT_ID, {
          workerName: 'test-worker',
          role: 'developer',
          poolKind: 'specialist',
          runtimeImage: 'agirunner-runtime:latest',
          cpuLimit: '2',
          memoryLimit: '2g',
          networkPolicy: 'restricted',
          environment: {},
          llmApiKeySecretRef: 'sk-live-secret',
          replicas: 1,
          enabled: true,
        }),
      ).rejects.toThrow('llmApiKeySecretRef must use secret: references');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects plaintext secret-bearing environment values in desired state writes', async () => {
      await expect(
        service.createWorker(TENANT_ID, {
          workerName: 'test-worker',
          role: 'developer',
          poolKind: 'specialist',
          runtimeImage: 'agirunner-runtime:latest',
          cpuLimit: '2',
          memoryLimit: '2g',
          networkPolicy: 'restricted',
          environment: {
            API_TOKEN: 'top-secret-token',
            nested: {
              authorization: 'Bearer nested-secret',
            },
          },
          replicas: 1,
          enabled: true,
        }),
      ).rejects.toThrow(
        'Environment field API_TOKEN must use secret: references instead of plaintext secret values',
      );
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects secret-shaped plaintext values under non-secret environment keys', async () => {
      await expect(
        service.createWorker(TENANT_ID, {
          workerName: 'test-worker',
          role: 'developer',
          poolKind: 'specialist',
          runtimeImage: 'agirunner-runtime:latest',
          cpuLimit: '2',
          memoryLimit: '2g',
          networkPolicy: 'restricted',
          environment: {
            opaque: 'sk-live-secret',
          },
          replicas: 1,
          enabled: true,
        }),
      ).rejects.toThrow(
        'Environment field opaque must use secret: references instead of plaintext secret values',
      );
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects invalid runtime image, cpu, and memory values', async () => {
      await expect(
        service.createWorker(TENANT_ID, {
          workerName: 'test-worker',
          role: 'developer',
          poolKind: 'specialist',
          runtimeImage: 'https://ghcr.io/agirunner/runtime latest',
          cpuLimit: 'zero',
          memoryLimit: 'banana',
          networkPolicy: 'restricted',
          environment: {},
          replicas: 1,
          enabled: true,
        }),
      ).rejects.toThrow('valid container image reference');
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('updateWorker', () => {
    it('updates specified fields and increments version', async () => {
      const updated = {
        ...sampleDesiredStateWithSecrets,
        replicas: 3,
        pool_kind: 'orchestrator',
        version: 2,
      };
      pool.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await service.updateWorker(TENANT_ID, WORKER_ID, {
        replicas: 3,
        poolKind: 'orchestrator',
      });

      expect(result.replicas).toBe(3);
      expect(result.pool_kind).toBe('orchestrator');
      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      expect(result.llm_api_key_secret_ref_configured).toBe(true);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('version = version + 1');
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.updateWorker(TENANT_ID, 'missing', { replicas: 2 })).rejects.toThrow(
        'Fleet worker not found',
      );
    });

    it('returns existing worker when no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDesiredStateWithSecrets], rowCount: 1 });

      const result = await service.updateWorker(TENANT_ID, WORKER_ID, {});

      expect(result.id).toBe(WORKER_ID);
      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      expect(result.llm_api_key_secret_ref_configured).toBe(true);
    });

    it('rejects plaintext secret-bearing nested environment updates', async () => {
      await expect(
        service.updateWorker(TENANT_ID, WORKER_ID, {
          environment: {
            nested: {
              authorization: 'Bearer nested-secret',
            },
          },
        }),
      ).rejects.toThrow(
        'Environment field nested.authorization must use secret: references instead of plaintext secret values',
      );
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('deleteWorker', () => {
    it('soft-deletes by disabling the worker', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.deleteWorker(TENANT_ID, WORKER_ID);

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('enabled = false');
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      await expect(service.deleteWorker(TENANT_ID, 'missing')).rejects.toThrow('Fleet worker not found');
    });
  });

  describe('restartWorker', () => {
    it('sets restart_requested flag', async () => {
      const restarted = { ...sampleDesiredStateWithSecrets, restart_requested: true };
      pool.query.mockResolvedValueOnce({ rows: [restarted], rowCount: 1 });

      const result = await service.restartWorker(TENANT_ID, WORKER_ID);

      expect(result.restart_requested).toBe(true);
      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('restart_requested = true');
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.restartWorker(TENANT_ID, 'missing')).rejects.toThrow('Fleet worker not found');
    });
  });

  describe('acknowledgeWorkerRestart', () => {
    it('clears restart_requested flag', async () => {
      const cleared = { ...sampleDesiredStateWithSecrets, restart_requested: false };
      pool.query.mockResolvedValueOnce({ rows: [cleared], rowCount: 1 });

      const result = await service.acknowledgeWorkerRestart(TENANT_ID, WORKER_ID);

      expect(result.restart_requested).toBe(false);
      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('restart_requested = false');
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.acknowledgeWorkerRestart(TENANT_ID, 'missing')).rejects.toThrow(
        'Fleet worker not found',
      );
    });
  });

  describe('drainWorker', () => {
    it('sets draining flag', async () => {
      const drained = { ...sampleDesiredStateWithSecrets, draining: true };
      pool.query.mockResolvedValueOnce({ rows: [drained], rowCount: 1 });

      const result = await service.drainWorker(TENANT_ID, WORKER_ID);

      expect(result.draining).toBe(true);
      expect(result).not.toHaveProperty('llm_api_key_secret_ref');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('draining = true');
    });
  });
});

