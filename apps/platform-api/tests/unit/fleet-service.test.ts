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
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].worker_name).toBe('test-worker');
      expect(result[0].actual).toEqual([sampleActualState]);
    });

    it('returns empty array when no workers exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.listWorkers(TENANT_ID);

      expect(result).toEqual([]);
    });
  });

  describe('getWorker', () => {
    it('returns worker with actual state', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [sampleActualState], rowCount: 1 });

      const result = await service.getWorker(TENANT_ID, WORKER_ID);

      expect(result.id).toBe(WORKER_ID);
      expect(result.actual).toEqual([sampleActualState]);
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.getWorker(TENANT_ID, 'missing')).rejects.toThrow('Fleet worker not found');
    });
  });

  describe('createWorker', () => {
    it('creates a new desired state entry', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 });

      const result = await service.createWorker(TENANT_ID, {
        workerName: 'test-worker',
        role: 'developer',
        poolKind: 'orchestrator',
        runtimeImage: 'agirunner-runtime:latest',
        cpuLimit: '2',
        memoryLimit: '2g',
        networkPolicy: 'restricted',
        environment: {},
        replicas: 1,
        enabled: true,
      });

      expect(result.worker_name).toBe('test-worker');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('orchestrator');
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO worker_desired_state');
    });
  });

  describe('updateWorker', () => {
    it('updates specified fields and increments version', async () => {
      const updated = { ...sampleDesiredState, replicas: 3, pool_kind: 'orchestrator', version: 2 };
      pool.query.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await service.updateWorker(TENANT_ID, WORKER_ID, {
        replicas: 3,
        poolKind: 'orchestrator',
      });

      expect(result.replicas).toBe(3);
      expect(result.pool_kind).toBe('orchestrator');
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
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDesiredState], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.updateWorker(TENANT_ID, WORKER_ID, {});

      expect(result.id).toBe(WORKER_ID);
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
      const restarted = { ...sampleDesiredState, restart_requested: true };
      pool.query.mockResolvedValueOnce({ rows: [restarted], rowCount: 1 });

      const result = await service.restartWorker(TENANT_ID, WORKER_ID);

      expect(result.restart_requested).toBe(true);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('restart_requested = true');
    });

    it('throws NotFoundError when worker does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.restartWorker(TENANT_ID, 'missing')).rejects.toThrow('Fleet worker not found');
    });
  });

  describe('drainWorker', () => {
    it('sets draining flag', async () => {
      const drained = { ...sampleDesiredState, draining: true };
      pool.query.mockResolvedValueOnce({ rows: [drained], rowCount: 1 });

      const result = await service.drainWorker(TENANT_ID, WORKER_ID);

      expect(result.draining).toBe(true);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('draining = true');
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
