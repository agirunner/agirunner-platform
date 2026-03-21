import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FleetService } from '../../src/services/fleet-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const WORKER_ID = '00000000-0000-0000-0000-000000000099';

const sampleDesiredState = {
  id: WORKER_ID,
  tenant_id: TENANT_ID,
  worker_name: 'test-worker',
  role: 'developer',
  pool_kind: 'specialist',
  runtime_image: 'agirunner-runtime:latest',
  cpu_limit: '2',
  memory_limit: '2g',
  network_policy: 'restricted',
  environment: {},
  llm_provider: null,
  llm_model: null,
  llm_api_key_secret_ref: null,
  replicas: 1,
  enabled: true,
  restart_requested: false,
  draining: false,
  version: 1,
  created_at: new Date(),
  updated_at: new Date(),
  updated_by: null,
};

const sampleDesiredStateWithSecrets = {
  ...sampleDesiredState,
  environment: {
    SAFE_NAME: 'worker-a',
    API_TOKEN: 'top-secret-token',
    opaque: 'sk-live-readback-secret',
    secrets_bundle: {
      username: 'service-user',
    },
    nested: {
      authorization: 'Bearer nested-secret',
      keep_ref: 'secret:RUNTIME_KEY',
    },
  },
  llm_api_key_secret_ref: 'secret:OPENAI_API_KEY',
};

const sampleActualState = {
  id: '00000000-0000-0000-0000-000000000050',
  desired_state_id: WORKER_ID,
  container_id: 'abc123',
  container_status: 'running',
  cpu_usage_percent: 12.5,
  memory_usage_bytes: 1048576,
  network_rx_bytes: 500,
  network_tx_bytes: 300,
  started_at: new Date(),
  last_updated: new Date(),
};

const sampleActiveTaskState = {
  desired_state_id: WORKER_ID,
  active_task_id: '00000000-0000-0000-0000-000000000123',
};

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

  describe('drainAllRuntimesForTenant', () => {
    it('marks all tenant runtimes for drain and returns the affected count', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      const affected = await service.drainAllRuntimesForTenant(TENANT_ID);

      expect(affected).toBe(3);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('UPDATE runtime_heartbeats');
      expect(sql).toContain('drain_requested = true');
      expect(sql).toContain('WHERE tenant_id = $1');
      expect(pool.query.mock.calls[0][1]).toEqual([TENANT_ID]);
    });

    it('returns zero when no tenant runtimes are connected', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const affected = await service.drainAllRuntimesForTenant(TENANT_ID);

      expect(affected).toBe(0);
    });
  });

  describe('listContainers', () => {
    it('returns actual state rows joined with desired state for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 });

      const result = await service.listContainers(TENANT_ID);

      expect(result).toEqual([sampleActualState]);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('JOIN worker_desired_state');
    });
  });

  describe('getContainerStats', () => {
    it('returns container stats by id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 });

      const result = await service.getContainerStats(sampleActualState.id);

      expect(result.container_id).toBe('abc123');
    });

    it('throws NotFoundError when container does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.getContainerStats('missing')).rejects.toThrow('Container not found');
    });
  });

  describe('listImages', () => {
    it('returns all images ordered by last_seen', async () => {
      const image = { id: 'img-1', repository: 'agirunner-runtime', tag: 'latest', digest: null, size_bytes: null, created_at: null, last_seen: new Date() };
      pool.query.mockResolvedValueOnce({ rows: [image], rowCount: 1 });

      const result = await service.listImages();

      expect(result).toEqual([image]);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ORDER BY last_seen DESC');
    });
  });

  describe('pruneStaleContainers', () => {
    it('removes containers with exited or dead status for the tenant', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 3 });

      const removed = await service.pruneStaleContainers(TENANT_ID);

      expect(removed).toBe(3);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('DELETE FROM worker_actual_state');
      expect(sql).toContain('container_status IN');
      const params = pool.query.mock.calls[0][1] as string[];
      expect(params).toContain('exited');
      expect(params).toContain('dead');
    });

    it('returns zero when no stale containers exist', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });

      const removed = await service.pruneStaleContainers(TENANT_ID);

      expect(removed).toBe(0);
    });
  });

  describe('requestImagePull', () => {
    it('inserts an image pull request record', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.requestImagePull('agirunner-runtime', 'v2.0');

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO container_images');
      const params = pool.query.mock.calls[0][1] as string[];
      expect(params[0]).toBe('agirunner-runtime');
      expect(params[1]).toBe('v2.0');
    });
  });

  describe('reportActualState', () => {
    it('upserts actual state via ON CONFLICT', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.reportActualState(WORKER_ID, 'container-xyz', 'running', {
        cpuPercent: 25.0,
        memoryBytes: 2048,
        rxBytes: 100,
        txBytes: 200,
      });

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
      expect(sql).toContain('DO UPDATE SET');
    });
  });

  describe('reportImage', () => {
    it('upserts image via ON CONFLICT', async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 1 });

      await service.reportImage('agirunner-runtime', 'v2.0', 'sha256:abc', 104857600);

      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT (repository, tag)');
    });
  });
});
