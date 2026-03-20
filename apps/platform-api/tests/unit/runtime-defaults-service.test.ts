import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RuntimeDefaultsService } from '../../src/services/runtime-defaults-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ID = '00000000-0000-0000-0000-000000000030';

const sampleDefault = {
  id: DEFAULT_ID,
  tenant_id: TENANT_ID,
  config_key: 'max_rework_attempts',
  config_value: '3',
  config_type: 'number',
  description: 'Maximum rework attempts',
  created_at: new Date(),
  updated_at: new Date(),
};

const sampleSecretDefault = {
  ...sampleDefault,
  config_key: 'custom.api_key_secret_ref',
  config_value: 'legacy-plaintext-secret',
  config_type: 'string',
  description: 'Custom API key secret ref',
};

describe('RuntimeDefaultsService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let fleetService: { drainAllRuntimesForTenant: ReturnType<typeof vi.fn> };
  let eventService: { emit: ReturnType<typeof vi.fn> };
  let service: RuntimeDefaultsService;

  beforeEach(() => {
    pool = createMockPool();
    fleetService = { drainAllRuntimesForTenant: vi.fn().mockResolvedValue(2) };
    eventService = { emit: vi.fn().mockResolvedValue(undefined) };
    service = new RuntimeDefaultsService(pool as never, undefined, eventService as never);
  });

  describe('listDefaults', () => {
    it('returns all defaults for tenant', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await service.listDefaults(TENANT_ID);
      expect(result).toEqual([sampleDefault]);
    });

    it('redacts secret-bearing runtime defaults on list reads', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

      const result = await service.listDefaults(TENANT_ID);

      expect(result).toEqual([
        {
          ...sampleSecretDefault,
          config_value: 'redacted://runtime-default-secret',
        },
      ]);
    });
  });

  describe('getDefault', () => {
    it('returns a default by id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await service.getDefault(TENANT_ID, DEFAULT_ID);
      expect(result).toEqual(sampleDefault);
    });

    it('throws NotFoundError when not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.getDefault(TENANT_ID, DEFAULT_ID)).rejects.toThrow(
        'Runtime default not found',
      );
    });

    it('redacts secret-bearing runtime defaults on single reads', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleSecretDefault], rowCount: 1 });

      const result = await service.getDefault(TENANT_ID, DEFAULT_ID);

      expect(result).toEqual({
        ...sampleSecretDefault,
        config_value: 'redacted://runtime-default-secret',
      });
    });
  });

  describe('getByKey', () => {
    it('returns default by config key', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });
      const result = await service.getByKey(TENANT_ID, 'max_rework_attempts');
      expect(result).toEqual(sampleDefault);
    });

    it('returns null when key not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await service.getByKey(TENANT_ID, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('createDefault', () => {
    it('creates a new runtime default', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // getByKey
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 }); // INSERT

      const result = await service.createDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });
      expect(result).toEqual(sampleDefault);
    });

    it('does not request runtime drain or rollout events after create', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await service.createDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });

      expect(fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(eventService.emit).not.toHaveBeenCalled();
    });

    it('throws ConflictError when key already exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'max_rework_attempts',
          configValue: '5',
          configType: 'number',
        }),
      ).rejects.toThrow('already exists');
    });

    it('rejects invalid config type', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'test',
          configValue: 'val',
          configType: 'invalid' as 'string',
        }),
      ).rejects.toThrow();
    });

    it('rejects empty config key', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: '',
          configValue: 'val',
          configType: 'string',
        }),
      ).rejects.toThrow();
    });

    it('redacts secret refs from create responses for secret-bearing defaults', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
        rows: [{ ...sampleSecretDefault, config_value: 'secret:SERPER_API_KEY' }],
        rowCount: 1,
      });

      const result = await service.createDefault(TENANT_ID, {
        configKey: 'custom.api_key_secret_ref',
        configValue: 'secret:SERPER_API_KEY',
        configType: 'string',
      });

      expect(result.config_value).toBe('redacted://runtime-default-secret');
    });

    it('rejects invalid runtime agent count defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.history_max_messages',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('agent.history_max_messages must be at least 1');
    });

    it('rejects invalid specialist runtime and execution capacity defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'specialist_runtime_bootstrap_claim_timeout_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow(
        'specialist_runtime_bootstrap_claim_timeout_seconds must be at least 1',
      );

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'specialist_runtime_drain_grace_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow(
        'specialist_runtime_drain_grace_seconds must be at least 1',
      );

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'global_max_execution_containers',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('global_max_execution_containers must be at least 1');
    });

    it('rejects removed legacy web search runtime defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'tools.web_search_provider',
          configValue: 'duckduckgo',
          configType: 'string',
        }),
      ).rejects.toThrow('tools.web_search_provider has been removed');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'tools.web_search_timeout_seconds',
          configValue: '30',
          configType: 'number',
        }),
      ).rejects.toThrow('tools.web_search_timeout_seconds has been removed');
    });

    it('rejects out-of-range runtime compaction defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.context_compaction_threshold',
          configValue: '1.4',
          configType: 'number',
        }),
      ).rejects.toThrow('agent.context_compaction_threshold must be between 0 and 1');
    });

    it('validates continuity strategy enums and booleans for agent context defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.specialist_context_strategy',
          configValue: 'mystery',
          configType: 'string',
        }),
      ).rejects.toThrow(
        'agent.specialist_context_strategy must be one of: auto, semantic_local, deterministic, provider_native, off',
      );

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.orchestrator_context_strategy',
          configValue: 'semantic_local',
          configType: 'string',
        }),
      ).rejects.toThrow(
        'agent.orchestrator_context_strategy must be one of: activation_checkpoint, emergency_only, off',
      );

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'agent.specialist_prepare_for_compaction_enabled',
          configValue: 'true',
          configType: 'string',
        }),
      ).rejects.toThrow('agent.specialist_prepare_for_compaction_enabled must use boolean config type');
    });

    it('rejects non-positive runtime and workspace defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'api.events_heartbeat_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('api.events_heartbeat_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'workspace.clone_timeout_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('workspace.clone_timeout_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'workspace.clone_max_retries',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('workspace.clone_max_retries must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'workspace.clone_backoff_base_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('workspace.clone_backoff_base_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'pool.refresh_interval_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('pool.refresh_interval_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'workspace.snapshot_interval',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('workspace.snapshot_interval must be at least 0');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container.max_reuse_age_seconds',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('container.max_reuse_age_seconds must be at least 0');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container.max_reuse_tasks',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('container.max_reuse_tasks must be at least 0');
    });

    it('rejects non-positive connected runtime timeout defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.claim_poll_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.claim_poll_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.log_ingest_timeout_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.log_ingest_timeout_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.log_flush_interval_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.log_flush_interval_ms must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.worker_key_expiry_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.worker_key_expiry_ms must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.agent_key_expiry_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.agent_key_expiry_ms must be at least 1');
    });

    it('rejects non-positive platform transport and webhook timing defaults', async () => {
      pool.query.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.event_stream_keepalive_interval_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.event_stream_keepalive_interval_ms must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.webhook_max_attempts',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.webhook_max_attempts must be at least 1');
    });

    it('rejects invalid agent supervision threshold defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.agent_heartbeat_threshold_multiplier',
          configValue: '0.5',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.agent_heartbeat_threshold_multiplier must be at least 1');
    });

    it('rejects invalid runtime process log levels', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'log.level',
          configValue: 'trace',
          configType: 'string',
        }),
      ).rejects.toThrow('log.level must be one of: debug, info, warn, error');
    });

    it('rejects non-positive task timeout defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'tasks.default_timeout_minutes',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('tasks.default_timeout_minutes must be at least 1');
    });

    it('rejects invalid queue, pool, snapshot, capture, and subagent defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'queue.max_concurrency',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('queue.max_concurrency must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'queue.max_depth',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('queue.max_depth must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'workspace.snapshot_max_per_task',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('workspace.snapshot_max_per_task must be at least 0');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'capture.push_retries',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('capture.push_retries must be at least 0');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'pool.enabled',
          configValue: 'true',
          configType: 'string',
        }),
      ).rejects.toThrow('pool.enabled must use boolean config type');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'pool.pool_size',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('pool.pool_size must be at least 0');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'subagent.max_concurrent',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('subagent.max_concurrent must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'subagent.max_total',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('subagent.max_total must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'subagent.max_depth',
          configValue: '-1',
          configType: 'number',
        }),
      ).rejects.toThrow('subagent.max_depth must be at least 0');
    });

    it('rejects non-positive container manager defaults', async () => {
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.hung_runtime_stale_after_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.hung_runtime_stale_after_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.log_flush_interval_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.log_flush_interval_ms must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.docker_event_reconnect_backoff_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.docker_event_reconnect_backoff_ms must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.crash_log_capture_timeout_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.crash_log_capture_timeout_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.starvation_threshold_seconds',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.starvation_threshold_seconds must be at least 1');

      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'container_manager.runtime_orphan_grace_cycles',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('container_manager.runtime_orphan_grace_cycles must be at least 1');
    });

    it('rejects invalid worker supervision defaults', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.worker_dispatch_ack_timeout_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.worker_dispatch_ack_timeout_ms must be at least 1');

      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.worker_offline_threshold_multiplier',
          configValue: '0.5',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.worker_offline_threshold_multiplier must be at least 1');
    });

    it('rejects non-positive lifecycle loop defaults', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(
        service.createDefault(TENANT_ID, {
          configKey: 'platform.lifecycle_dispatch_loop_interval_ms',
          configValue: '0',
          configType: 'number',
        }),
      ).rejects.toThrow('platform.lifecycle_dispatch_loop_interval_ms must be at least 1');
    });

    it('allows zero-valued workspace snapshot and container reuse defaults', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            { ...sampleDefault, config_key: 'workspace.snapshot_interval', config_value: '0' },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            { ...sampleDefault, config_key: 'container.max_reuse_age_seconds', config_value: '0' },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ ...sampleDefault, config_key: 'container.max_reuse_tasks', config_value: '0' }],
          rowCount: 1,
        });

      const snapshot = await service.upsertDefault(TENANT_ID, {
        configKey: 'workspace.snapshot_interval',
        configValue: '0',
        configType: 'number',
      });
      const age = await service.upsertDefault(TENANT_ID, {
        configKey: 'container.max_reuse_age_seconds',
        configValue: '0',
        configType: 'number',
      });
      const tasks = await service.upsertDefault(TENANT_ID, {
        configKey: 'container.max_reuse_tasks',
        configValue: '0',
        configType: 'number',
      });

      expect(snapshot.config_key).toBe('workspace.snapshot_interval');
      expect(snapshot.config_value).toBe('0');
      expect(age.config_key).toBe('container.max_reuse_age_seconds');
      expect(age.config_value).toBe('0');
      expect(tasks.config_key).toBe('container.max_reuse_tasks');
      expect(tasks.config_value).toBe('0');
    });
  });

  describe('updateDefault', () => {
    it('updates a runtime default', async () => {
      const updated = { ...sampleDefault, config_value: '5' };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: '5',
      });
      expect(result.config_value).toBe('5');
    });

    it('does not request runtime drain or rollout events after update', async () => {
      const updated = { ...sampleDefault, config_value: '5' };
      pool.query
        .mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      await service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: '5',
      });

      expect(fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(eventService.emit).not.toHaveBeenCalled();
    });

    it('returns current default when no fields to update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await service.updateDefault(TENANT_ID, DEFAULT_ID, {});
      expect(result).toEqual(sampleDefault);
    });

    it('does not drain runtimes for a no-op update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await service.updateDefault(TENANT_ID, DEFAULT_ID, {});

      expect(fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(eventService.emit).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when default not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await expect(
        service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '10' }),
      ).rejects.toThrow('Runtime default not found');
    });

    it('rejects invalid runtime safeguard updates', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            ...sampleDefault,
            config_key: 'agent.max_iterations',
            config_value: '25',
            config_type: 'number',
          },
        ],
        rowCount: 1,
      });

      await expect(
        service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '0' }),
      ).rejects.toThrow('agent.max_iterations must be at least 1');
    });

    it('rejects invalid reactive burst safeguard updates', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [
          {
            ...sampleDefault,
            config_key: 'agent.max_parallel_tool_calls_per_burst',
            config_value: '4',
            config_type: 'number',
          },
        ],
        rowCount: 1,
      });

      await expect(
        service.updateDefault(TENANT_ID, DEFAULT_ID, { configValue: '0' }),
      ).rejects.toThrow('agent.max_parallel_tool_calls_per_burst must be at least 1');
    });

    it('redacts secret refs from update responses for secret-bearing defaults', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:SERPER_API_KEY' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ ...sampleSecretDefault, config_value: 'secret:TAVILY_API_KEY' }],
          rowCount: 1,
        });

      const result = await service.updateDefault(TENANT_ID, DEFAULT_ID, {
        configValue: 'secret:TAVILY_API_KEY',
      });

      expect(result.config_value).toBe('redacted://runtime-default-secret');
    });
  });

  describe('upsertDefault', () => {
    it('inserts or updates via ON CONFLICT', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      const result = await service.upsertDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });
      expect(result).toEqual(sampleDefault);
      const sql = pool.query.mock.calls[0][0] as string;
      expect(sql).toContain('ON CONFLICT');
    });

    it('does not request runtime drain or rollout events after upsert', async () => {
      pool.query.mockResolvedValueOnce({ rows: [sampleDefault], rowCount: 1 });

      await service.upsertDefault(TENANT_ID, {
        configKey: 'max_rework_attempts',
        configValue: '3',
        configType: 'number',
        description: 'Maximum rework attempts',
      });

      expect(fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(eventService.emit).not.toHaveBeenCalled();
    });
  });

  describe('deleteDefault', () => {
    it('deletes a runtime default', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
      await expect(service.deleteDefault(TENANT_ID, DEFAULT_ID)).resolves.toBeUndefined();
    });

    it('does not request runtime drain or rollout events after delete', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await service.deleteDefault(TENANT_ID, DEFAULT_ID, 'max_rework_attempts');

      expect(fleetService.drainAllRuntimesForTenant).not.toHaveBeenCalled();
      expect(eventService.emit).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when default not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      await expect(service.deleteDefault(TENANT_ID, DEFAULT_ID)).rejects.toThrow(
        'Runtime default not found',
      );
    });
  });
});
