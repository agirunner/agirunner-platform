import { describe, expect, it, vi, beforeEach } from 'vitest';

import { FleetService } from '../../src/services/fleet-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const TEMPLATE_ID = '00000000-0000-0000-0000-000000000010';
const RUNTIME_ID = '00000000-0000-0000-0000-000000000020';

describe('FleetService DCM', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: FleetService;

  beforeEach(() => {
    pool = createMockPool();
    service = new FleetService(pool as never);
  });

  describe('getQueueDepth', () => {
    it('returns total and per-template counts', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          { template_id: TEMPLATE_ID, count: 3 },
          { template_id: '00000000-0000-0000-0000-000000000011', count: 2 },
        ],
        rowCount: 2,
      });

      const result = await service.getQueueDepth(TENANT_ID);

      expect(result.total_pending).toBe(5);
      expect(result.by_template[TEMPLATE_ID]).toBe(3);
    });

    it('returns zero when no pending tasks', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getQueueDepth(TENANT_ID);

      expect(result.total_pending).toBe(0);
      expect(result.by_template).toEqual({});
    });

    it('filters by template_id when provided', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ template_id: TEMPLATE_ID, count: 3 }],
        rowCount: 1,
      });

      await service.getQueueDepth(TENANT_ID, TEMPLATE_ID);

      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('template_id');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain(TEMPLATE_ID);
    });
  });

  describe('getRuntimeTargets', () => {
    it('returns targets derived from templates with runtime config', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          template_id: TEMPLATE_ID,
          template_name: 'SDLC Pipeline',
          schema: {
            runtime: {
              pool_mode: 'warm',
              max_runtimes: 2,
              priority: 5,
              idle_timeout_seconds: 300,
              grace_period_seconds: 180,
              image: 'agirunner-runtime:v1',
              pull_policy: 'always',
              cpu: '2.0',
              memory: '1g',
            },
          },
          active_workflows: 1,
          pending_tasks: 3,
        }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0].template_id).toBe(TEMPLATE_ID);
      expect(result[0].pool_mode).toBe('warm');
      expect(result[0].max_runtimes).toBe(2);
      expect(result[0].priority).toBe(5);
      expect(result[0].image).toBe('agirunner-runtime:v1');
      expect(result[0].pending_tasks).toBe(3);
      expect(result[0].active_workflows).toBe(1);
    });

    it('applies defaults when runtime config fields are missing', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          template_id: TEMPLATE_ID,
          template_name: 'Minimal',
          schema: { runtime: {} },
          active_workflows: 0,
          pending_tasks: 0,
        }],
        rowCount: 1,
      });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result[0].pool_mode).toBe('warm');
      expect(result[0].max_runtimes).toBe(1);
      expect(result[0].priority).toBe(0);
      expect(result[0].idle_timeout_seconds).toBe(300);
      expect(result[0].grace_period_seconds).toBe(180);
      expect(result[0].image).toBe('agirunner-runtime:local');
      expect(result[0].pull_policy).toBe('if-not-present');
      expect(result[0].cpu).toBe('1.0');
      expect(result[0].memory).toBe('512m');
    });

    it('returns empty array when no templates have runtime config', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getRuntimeTargets(TENANT_ID);

      expect(result).toEqual([]);
    });
  });

  describe('recordHeartbeat', () => {
    it('upserts heartbeat and returns should_drain false', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: false }],
        rowCount: 1,
      });

      const result = await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        template_id: TEMPLATE_ID,
        state: 'idle',
        uptime_seconds: 120,
        image: 'agirunner-runtime:local',
      });

      expect(result.should_drain).toBe(false);
      expect(pool.query).toHaveBeenCalledTimes(1);
      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('ON CONFLICT');
      expect(query).toContain('RETURNING drain_requested');
    });

    it('returns should_drain true when drain_requested', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: true }],
        rowCount: 1,
      });

      const result = await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        template_id: TEMPLATE_ID,
        state: 'idle',
        uptime_seconds: 120,
        image: 'agirunner-runtime:local',
      });

      expect(result.should_drain).toBe(true);
    });

    it('accepts executing state with task_id', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: false }],
        rowCount: 1,
      });

      await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        template_id: TEMPLATE_ID,
        state: 'executing',
        task_id: '00000000-0000-0000-0000-000000000030',
        uptime_seconds: 300,
        image: 'agirunner-runtime:local',
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('executing');
      expect(params).toContain('00000000-0000-0000-0000-000000000030');
    });

    it('accepts draining state', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ drain_requested: false }],
        rowCount: 1,
      });

      await service.recordHeartbeat(TENANT_ID, {
        runtime_id: RUNTIME_ID,
        template_id: TEMPLATE_ID,
        state: 'draining',
        image: 'agirunner-runtime:local',
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params).toContain('draining');
    });

    it('rejects invalid state', async () => {
      await expect(
        service.recordHeartbeat(TENANT_ID, {
          runtime_id: RUNTIME_ID,
          template_id: TEMPLATE_ID,
          state: 'exploding',
          image: 'agirunner-runtime:local',
        }),
      ).rejects.toThrow(/Invalid heartbeat state/);
    });
  });

  describe('drainRuntime', () => {
    it('sets drain_requested on existing heartbeat', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

      await service.drainRuntime(TENANT_ID, RUNTIME_ID);

      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('drain_requested = true');
      expect(query).toContain('runtime_heartbeats');
    });

    it('throws NotFoundError when runtime not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(service.drainRuntime(TENANT_ID, RUNTIME_ID)).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe('getFleetStatus', () => {
    it('aggregates runtime states across templates', async () => {
      // First call: global_max_runtimes config
      pool.query.mockResolvedValueOnce({
        rows: [{ config_value: '10' }],
        rowCount: 1,
      });
      // Second call: heartbeats
      pool.query.mockResolvedValueOnce({
        rows: [
          { runtime_id: RUNTIME_ID, tenant_id: TENANT_ID, template_id: TEMPLATE_ID, template_name: 'SDLC', state: 'executing', task_id: null },
          { runtime_id: '00000000-0000-0000-0000-000000000021', tenant_id: TENANT_ID, template_id: TEMPLATE_ID, template_name: 'SDLC', state: 'idle', task_id: null },
        ],
        rowCount: 2,
      });
      // Third call: runtime targets
      pool.query.mockResolvedValueOnce({
        rows: [{
          template_id: TEMPLATE_ID,
          template_name: 'SDLC',
          schema: { runtime: { max_runtimes: 3 } },
          active_workflows: 1,
          pending_tasks: 2,
        }],
        rowCount: 1,
      });

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.global_max_runtimes).toBe(10);
      expect(result.total_running).toBe(2);
      expect(result.total_idle).toBe(1);
      expect(result.total_executing).toBe(1);
      expect(result.total_draining).toBe(0);
      expect(result.by_template).toHaveLength(1);
      expect(result.by_template[0].running).toBe(2);
      expect(result.by_template[0].max_runtimes).toBe(3);
      expect(result.by_template[0].pending_tasks).toBe(2);
    });

    it('uses default global_max_runtimes when not configured', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await service.getFleetStatus(TENANT_ID);

      expect(result.global_max_runtimes).toBe(10);
      expect(result.total_running).toBe(0);
    });
  });

  describe('listFleetEvents', () => {
    it('returns paginated events', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 25 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            { id: '1', event_type: 'runtime.started', level: 'info', created_at: new Date() },
          ],
          rowCount: 1,
        });

      const result = await service.listFleetEvents(TENANT_ID, { limit: 10, offset: 0 });

      expect(result.total).toBe(25);
      expect(result.events).toHaveLength(1);
    });

    it('applies template_id filter', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 5 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listFleetEvents(TENANT_ID, { template_id: TEMPLATE_ID });

      const countQuery = pool.query.mock.calls[0][0] as string;
      expect(countQuery).toContain('template_id');
    });

    it('applies runtime_id filter', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listFleetEvents(TENANT_ID, { runtime_id: RUNTIME_ID });

      const countQuery = pool.query.mock.calls[0][0] as string;
      expect(countQuery).toContain('runtime_id');
    });

    it('applies time range filters', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await service.listFleetEvents(TENANT_ID, {
        since: '2026-01-01T00:00:00Z',
        until: '2026-12-31T23:59:59Z',
      });

      const countQuery = pool.query.mock.calls[0][0] as string;
      expect(countQuery).toContain('created_at >=');
      expect(countQuery).toContain('created_at <=');
    });
  });

  describe('recordFleetEvent', () => {
    it('inserts event with all fields', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await service.recordFleetEvent(TENANT_ID, {
        event_type: 'runtime.started',
        level: 'info',
        runtime_id: RUNTIME_ID,
        template_id: TEMPLATE_ID,
        container_id: 'abc123',
        payload: { image: 'agirunner-runtime:local' },
      });

      expect(pool.query).toHaveBeenCalledTimes(1);
      const query = pool.query.mock.calls[0][0] as string;
      expect(query).toContain('fleet_events');
      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[1]).toBe('runtime.started');
    });

    it('uses info as default level', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await service.recordFleetEvent(TENANT_ID, {
        event_type: 'container.created',
      });

      const params = pool.query.mock.calls[0][1] as unknown[];
      expect(params[2]).toBe('info');
    });

    it('rejects invalid event type', async () => {
      await expect(
        service.recordFleetEvent(TENANT_ID, {
          event_type: 'invalid.event',
        }),
      ).rejects.toThrow(/Invalid fleet event type/);
    });

    it('rejects invalid event level', async () => {
      await expect(
        service.recordFleetEvent(TENANT_ID, {
          event_type: 'runtime.started',
          level: 'critical',
        }),
      ).rejects.toThrow(/Invalid fleet event level/);
    });

    it('accepts all valid event types', async () => {
      const validTypes = [
        'runtime.started',
        'runtime.task.claimed',
        'runtime.task.completed',
        'runtime.task.failed',
        'runtime.idle',
        'runtime.draining',
        'runtime.shutdown',
        'runtime.hung_detected',
        'container.created',
        'container.destroyed',
        'orphan.cleaned',
      ];

      for (const eventType of validTypes) {
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await service.recordFleetEvent(TENANT_ID, { event_type: eventType });
      }

      expect(pool.query).toHaveBeenCalledTimes(validTypes.length);
    });

    it('accepts all valid event levels', async () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];

      for (const level of validLevels) {
        pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await service.recordFleetEvent(TENANT_ID, {
          event_type: 'runtime.started',
          level,
        });
      }

      expect(pool.query).toHaveBeenCalledTimes(validLevels.length);
    });
  });
});
