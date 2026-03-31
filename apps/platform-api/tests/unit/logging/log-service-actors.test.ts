import { describe, expect, it } from 'vitest';

import { createLogServiceHarness } from './support.js';

describe('LogService', () => {
  describe('actor and workflow facets', () => {
    it('queriesDistinctActorKindsWithLatestWorkflowContext', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{
          actor_kind: 'specialist_agent',
          actor_id: null,
          actor_name: null,
          count: '45',
          latest_role: 'developer',
          latest_workflow_id: 'wf-1',
          latest_workflow_name: 'Customer migration',
          latest_workflow_label: 'Customer migration',
        }],
        rowCount: 2,
      });

      const result = await service.actors('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
        workflowId: 'wf-1',
        operation: ['tool.exec'],
        role: ['developer'],
      });

      expect(result).toEqual([{
        actor_kind: 'specialist_agent',
        actor_id: null,
        actor_name: null,
        count: 45,
        latest_role: 'developer',
        latest_workflow_id: 'wf-1',
        latest_workflow_name: 'Customer migration',
        latest_workflow_label: 'Customer migration',
      }]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).not.toContain('actor_id IS NOT NULL');
      expect(sql).toContain('ROW_NUMBER() OVER');
      expect(sql).toContain('workflow_id = $');
      expect(sql).toContain('operation = ANY(');
      expect(sql).toContain('role = ANY(');
      expect(sql).toContain('GROUP BY actor_kind');
      expect(params).toContain('wf-1');
    });

    it('classifies orchestrator agent rows from agent actors as orchestrator agents', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{
          actor_kind: 'orchestrator_agent',
          actor_id: null,
          actor_name: null,
          count: '18',
          latest_role: 'orchestrator',
          latest_workflow_id: 'wf-1',
          latest_workflow_name: 'Customer migration',
          latest_workflow_label: 'Customer migration',
        }],
        rowCount: 1,
      });

      const result = await service.actors('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
      });

      expect(result).toEqual([{
        actor_kind: 'orchestrator_agent',
        actor_id: null,
        actor_name: null,
        count: 18,
        latest_role: 'orchestrator',
        latest_workflow_id: 'wf-1',
        latest_workflow_name: 'Customer migration',
        latest_workflow_label: 'Customer migration',
      }]);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain("WHEN l.actor_type IN ('worker', 'agent')");
      expect(sql).toContain("LOWER(COALESCE(l.role, '')) = 'orchestrator'");
      expect(sql).toContain("COALESCE(l.is_orchestrator_task, false) = true");
      expect(sql).toContain("THEN 'orchestrator_agent'");
    });

    it('queriesDistinctActorKindsWithoutCounts', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{ actor_kind: 'orchestrator_agent' }, { actor_kind: 'specialist_agent' }],
        rowCount: 2,
      });

      const result = await service.actorKindValues('tenant-1', {
        since: new Date('2026-03-08T00:00:00Z').toISOString(),
      });

      expect(result).toEqual([
        { actor_kind: 'orchestrator_agent' },
        { actor_kind: 'specialist_agent' },
      ]);
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('SELECT DISTINCT CASE');
      expect(sql).toContain("THEN 'orchestrator_agent'");
      expect(sql).not.toContain('COUNT(*)');
      expect(sql).not.toContain('GROUP BY actor_kind');
    });

    it('ordersByNameOrIdWithoutMixingTextAndUuidTypes', async () => {
      const { pool, service } = createLogServiceHarness();
      pool.query.mockResolvedValue({
        rows: [{ id: 'wf-1', name: 'Customer migration', workspace_id: 'ws-1' }],
        rowCount: 1,
      });

      const result = await service.workflowValues('tenant-1', { workspaceId: 'ws-1' });

      expect(result).toEqual([
        { id: 'wf-1', name: 'Customer migration', workspace_id: 'ws-1' },
      ]);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("ORDER BY COALESCE(NULLIF(TRIM(w.name), ''), w.id::text) ASC");
      expect(params).toContain('ws-1');
    });
  });
});
