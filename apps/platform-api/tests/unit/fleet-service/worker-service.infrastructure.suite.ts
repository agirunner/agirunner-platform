import { beforeEach, describe, expect, it } from 'vitest';

import { FleetService } from '../../../src/services/fleet-service.js';
import {
  createMockPool,
  sampleActualState,
  TENANT_ID,
  WORKER_ID,
} from './support.js';

describe('FleetService infrastructure operations', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: FleetService;

  beforeEach(() => {
    pool = createMockPool();
    service = new FleetService(pool as never);
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
      const image = {
        id: 'img-1',
        repository: 'agirunner-runtime',
        tag: 'latest',
        digest: null,
        size_bytes: null,
        created_at: null,
        last_seen: new Date(),
      };
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

