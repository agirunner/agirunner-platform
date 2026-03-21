import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContainerInventoryService,
  type LiveContainerInventoryInput,
} from '../../src/services/container-inventory-service.js';

function createMockPool() {
  return { query: vi.fn() };
}

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

describe('ContainerInventoryService', () => {
  let pool: ReturnType<typeof createMockPool>;
  let service: ContainerInventoryService;

  beforeEach(() => {
    pool = createMockPool();
    service = new ContainerInventoryService(pool as never);
  });

  it('replaces the tenant live snapshot and lists enriched current rows', async () => {
    const snapshot: LiveContainerInventoryInput[] = [
      {
        container_id: 'orchestrator-container-1',
        name: 'orchestrator-primary',
        kind: 'orchestrator',
        state: 'running',
        status: 'Up 8 minutes',
        image: 'agirunner-runtime:local',
        cpu_limit: '1',
        memory_limit: '512m',
        started_at: '2026-03-21T18:22:00.000Z',
        desired_state_id: '00000000-0000-0000-0000-000000000010',
      },
      {
        container_id: 'runtime-container-1',
        name: 'runtime-speciali-3262b311',
        kind: 'runtime',
        state: 'running',
        status: 'Up 4 minutes',
        image: 'agirunner-runtime:local',
        cpu_limit: '2',
        memory_limit: '1536m',
        started_at: '2026-03-21T18:24:00.000Z',
        runtime_id: 'runtime-1',
      },
      {
        container_id: 'task-container-1',
        name: 'task-3d749b2c',
        kind: 'task',
        state: 'running',
        status: 'Up 90 seconds',
        image: 'agirunner-runtime-execution:local',
        cpu_limit: '1',
        memory_limit: '768m',
        started_at: '2026-03-21T18:26:00.000Z',
        runtime_id: 'runtime-1',
        task_id: '00000000-0000-0000-0000-000000000111',
        workflow_id: '00000000-0000-0000-0000-000000000222',
        role_name: 'developer',
      },
    ];

    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'orchestrator:orchestrator-primary',
          kind: 'orchestrator',
          name: 'orchestrator-primary',
          state: 'running',
          status: 'Up 8 minutes',
          image: 'agirunner-runtime:local',
          cpu_limit: '1',
          memory_limit: '512m',
          started_at: new Date('2026-03-21T18:22:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          role_name: 'orchestrator',
          playbook_id: null,
          playbook_name: null,
          workflow_id: '00000000-0000-0000-0000-000000000222',
          workflow_name: 'Fix login bug',
          task_id: '00000000-0000-0000-0000-000000000333',
          task_title: 'Coordinate workflow',
          activity_state: 'claimed',
        },
        {
          id: 'runtime:runtime-1',
          kind: 'runtime',
          name: 'runtime-speciali-3262b311',
          state: 'running',
          status: 'Up 4 minutes',
          image: 'agirunner-runtime:local',
          cpu_limit: '2',
          memory_limit: '1536m',
          started_at: new Date('2026-03-21T18:24:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          role_name: 'developer',
          playbook_id: '00000000-0000-0000-0000-000000000555',
          playbook_name: 'Bug Investigation',
          workflow_id: '00000000-0000-0000-0000-000000000222',
          workflow_name: 'Fix login bug',
          task_id: '00000000-0000-0000-0000-000000000111',
          task_title: 'Investigate auth timeout',
          activity_state: 'executing',
        },
        {
          id: 'task:00000000-0000-0000-0000-000000000111',
          kind: 'task',
          name: 'task-3d749b2c',
          state: 'running',
          status: 'Up 90 seconds',
          image: 'agirunner-runtime-execution:local',
          cpu_limit: '1',
          memory_limit: '768m',
          started_at: new Date('2026-03-21T18:26:00.000Z'),
          last_seen_at: new Date('2026-03-21T18:30:00.000Z'),
          role_name: 'developer',
          playbook_id: '00000000-0000-0000-0000-000000000555',
          playbook_name: 'Bug Investigation',
          workflow_id: '00000000-0000-0000-0000-000000000222',
          workflow_name: 'Fix login bug',
          task_id: '00000000-0000-0000-0000-000000000111',
          task_title: 'Investigate auth timeout',
          activity_state: 'in_progress',
        },
      ],
      rowCount: 3,
    });

    await service.replaceLiveSnapshot(TENANT_ID, snapshot);
    const rows = await service.listCurrentContainers(TENANT_ID);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'orchestrator:orchestrator-primary',
      kind: 'orchestrator',
      cpu_limit: '1',
      memory_limit: '512m',
      workflow_name: 'Fix login bug',
    });
    expect(rows[1]).toMatchObject({
      id: 'runtime:runtime-1',
      kind: 'runtime',
      playbook_name: 'Bug Investigation',
      role_name: 'developer',
    });
    expect(rows[2]).toMatchObject({
      id: 'task:00000000-0000-0000-0000-000000000111',
      kind: 'task',
      image: 'agirunner-runtime-execution:local',
      task_title: 'Investigate auth timeout',
    });

    const replaceQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(replaceQuery).toContain('DELETE FROM live_container_inventory');
    expect(replaceQuery).toContain('INSERT INTO live_container_inventory');

    const listQuery = pool.query.mock.calls[1]?.[0] as string;
    expect(listQuery).toContain('FROM live_container_inventory live');
    expect(listQuery).toContain('LEFT JOIN runtime_heartbeats rh');
    expect(listQuery).toContain('LEFT JOIN tasks t');
    expect(listQuery).toContain('LEFT JOIN workflows w');
  });

  it('deduplicates live snapshot rows by container id before replacing the tenant snapshot', async () => {
    const snapshot: LiveContainerInventoryInput[] = [
      {
        container_id: 'runtime-container-1',
        name: 'runtime-specialist-1',
        kind: 'runtime',
        state: 'running',
        status: 'Up 30 seconds',
        image: 'agirunner-runtime:old',
      },
      {
        container_id: 'runtime-container-1',
        name: 'runtime-specialist-1',
        kind: 'runtime',
        state: 'running',
        status: 'Up 45 seconds',
        image: 'agirunner-runtime:new',
      },
    ];

    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.replaceLiveSnapshot(TENANT_ID, snapshot);

    const params = pool.query.mock.calls[0]?.[1] as [string, string];
    const payload = JSON.parse(params[1]) as LiveContainerInventoryInput[];

    expect(payload).toHaveLength(1);
    expect(payload[0]).toMatchObject({
      container_id: 'runtime-container-1',
      status: 'Up 45 seconds',
      image: 'agirunner-runtime:new',
    });
  });

  it('joins runtime heartbeats without comparing uuid values to text container labels', async () => {
    pool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.listCurrentContainers(TENANT_ID);

    const listQuery = pool.query.mock.calls[0]?.[0] as string;
    expect(listQuery).toContain('rh.runtime_id::text = live.runtime_id');
    expect(listQuery).not.toContain('rh.runtime_id = live.runtime_id');
    expect(listQuery).toContain("COALESCE(p.id::text, NULLIF(BTRIM(live.live_playbook_id), ''))");
  });
});
