import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { ToolTagService } from '../../../src/services/tool-tag-service.js';

function mockIdentity(tenantId = 'tenant-1') {
  return { tenantId, id: 'key-1', scope: 'admin' as const, ownerType: 'user' as const, ownerId: 'user-1', keyPrefix: 'ab_' };
}

describe('ToolTagService', () => {
  describe('listToolTags', () => {
    it('merges built-in and custom tools with is_built_in flag', async () => {
      const pool = {
        query: vi.fn(async () => ({
          rowCount: 1,
          rows: [{ id: 'my_tool', name: 'My Tool', description: 'Custom', category: 'web' }],
        })),
      };

      const service = new ToolTagService(pool as never);
      const result = await service.listToolTags('tenant-1');

      const shellExec = result.data.find((t: Record<string, unknown>) => t.id === 'shell_exec');
      expect(shellExec).toBeDefined();
      expect(shellExec!.is_built_in).toBe(true);
      expect(shellExec!.owner).toBe('task');

      const myTool = result.data.find((t: Record<string, unknown>) => t.id === 'my_tool');
      expect(myTool).toBeDefined();
      expect(myTool!.is_built_in).toBe(false);
      expect(myTool!.name).toBe('My Tool');
    });

    it('includes continuity and handoff tools in the built-in catalog', async () => {
      const pool = {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      };

      const service = new ToolTagService(pool as never);
      const result = await service.listToolTags('tenant-1');
      const ids = new Set(result.data.map((entry: Record<string, unknown>) => String(entry.id)));

      expect(ids.has('advance_stage')).toBe(true);
      expect(ids.has('advance_checkpoint')).toBe(false);
      expect(ids.has('submit_handoff')).toBe(true);
      expect(ids.has('read_predecessor_handoff')).toBe(true);
      expect(ids.has('read_work_item_continuity')).toBe(true);
      expect(ids.has('read_latest_handoff')).toBe(true);
      expect(ids.has('read_handoff_chain')).toBe(true);
      expect(ids.has('list_workflow_tasks')).toBe(true);
      expect(ids.has('artifact_document_read')).toBe(true);
      expect(ids.has('send_task_message')).toBe(true);
    });

    it('classifies built-in tools by runtime or task owner', async () => {
      const pool = {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      };

      const service = new ToolTagService(pool as never);
      const result = await service.listToolTags('tenant-1');
      const byId = new Map(
        result.data.map((entry: Record<string, unknown>) => [String(entry.id), entry]),
      );

      expect(byId.get('artifact_list')).toEqual(expect.objectContaining({ owner: 'runtime' }));
      expect(byId.get('artifact_document_read')).toEqual(
        expect.objectContaining({ owner: 'runtime' }),
      );
      expect(byId.get('native_search')).toEqual(expect.objectContaining({ owner: 'runtime' }));
      expect(byId.get('shell_exec')).toEqual(expect.objectContaining({ owner: 'task' }));
      expect(byId.get('web_fetch')).toEqual(expect.objectContaining({ owner: 'task' }));
      expect(byId.get('grep')).toEqual(expect.objectContaining({ owner: 'task' }));
      expect(byId.get('glob')).toEqual(expect.objectContaining({ owner: 'task' }));
    });

    it('exposes access scope and callability for built-in tools', async () => {
      const pool = {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      };

      const service = new ToolTagService(pool as never);
      const result = await service.listToolTags('tenant-1');
      const byId = new Map(
        result.data.map((entry: Record<string, unknown>) => [String(entry.id), entry]),
      );

      expect(byId.get('file_read')).toEqual(
        expect.objectContaining({
          access_scope: 'specialist_and_orchestrator',
          usage_surface: 'task_sandbox',
          is_callable: true,
        }),
      );
      expect(byId.get('create_task')).toEqual(
        expect.objectContaining({
          access_scope: 'orchestrator_only',
          usage_surface: 'runtime',
          is_callable: true,
        }),
      );
      expect(byId.get('native_search')).toEqual(
        expect.objectContaining({
          access_scope: 'specialist_and_orchestrator',
          usage_surface: 'provider_capability',
          is_callable: false,
        }),
      );
    });

    it('exposes current task review controls while excluding legacy aliases', async () => {
      const pool = {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      };

      const service = new ToolTagService(pool as never);
      const result = await service.listToolTags('tenant-1');
      const ids = new Set(result.data.map((entry: Record<string, unknown>) => String(entry.id)));

      expect(ids.has('approve_task')).toBe(true);
      expect(ids.has('approve_task_output')).toBe(true);
      expect(ids.has('request_rework')).toBe(true);
      expect(ids.has('request_task_changes')).toBe(false);
    });
  });

  describe('createToolTag', () => {
    it('rejects creation that shadows a built-in tool id', async () => {
      const pool = { query: vi.fn() };
      const service = new ToolTagService(pool as never);

      await expect(
        service.createToolTag(mockIdentity(), {
          id: 'shell_exec',
          name: 'Shadow Shell Exec',
          category: 'execution',
        }),
      ).rejects.toThrow('Built-in tools cannot be modified');
    });
  });

  describe('updateToolTag', () => {
    it('rejects updates to built-in tools', async () => {
      const pool = { query: vi.fn() };
      const service = new ToolTagService(pool as never);

      await expect(
        service.updateToolTag(mockIdentity(), 'shell_exec', { name: 'Renamed' }),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.updateToolTag(mockIdentity(), 'shell_exec', { name: 'Renamed' }),
      ).rejects.toThrow('Built-in tools cannot be modified');
    });

    it('rejects empty update bodies', async () => {
      const pool = { query: vi.fn() };
      const service = new ToolTagService(pool as never);

      await expect(
        service.updateToolTag(mockIdentity(), 'my_tool', {}),
      ).rejects.toThrow('At least one field is required');
    });

    it('rejects empty name', async () => {
      const pool = { query: vi.fn() };
      const service = new ToolTagService(pool as never);

      await expect(
        service.updateToolTag(mockIdentity(), 'my_tool', { name: '  ' }),
      ).rejects.toThrow('Tool tag name cannot be empty');
    });

    it('rejects invalid category', async () => {
      const pool = { query: vi.fn() };
      const service = new ToolTagService(pool as never);

      await expect(
        service.updateToolTag(mockIdentity(), 'my_tool', { category: 'invalid' }),
      ).rejects.toThrow('Tool tag category is invalid');
    });

    it('updates a custom tool and returns the updated row', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({
          rowCount: 1,
          rows: [{ id: 'my_tool', name: 'Updated Name', description: 'New desc', category: 'web' }],
        }),
      };

      const service = new ToolTagService(pool as never);
      const result = await service.updateToolTag(mockIdentity(), 'my_tool', {
        name: 'Updated Name',
        description: 'New desc',
      });

      expect(result).toEqual({ id: 'my_tool', name: 'Updated Name', description: 'New desc', category: 'web' });
      expect(pool.query).toHaveBeenCalledTimes(1);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE tool_tags');
      expect(sql).toContain('name = $3');
      expect(sql).toContain('description = $4');
      expect(params).toEqual(['tenant-1', 'my_tool', 'Updated Name', 'New desc']);
    });

    it('throws when tool is not found', async () => {
      const pool = {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      };

      const service = new ToolTagService(pool as never);

      await expect(
        service.updateToolTag(mockIdentity(), 'nonexistent', { name: 'X' }),
      ).rejects.toThrow('Tool not found');
    });
  });

  describe('deleteToolTag', () => {
    it('rejects deletion of built-in tools', async () => {
      const pool = { query: vi.fn() };
      const service = new ToolTagService(pool as never);

      await expect(
        service.deleteToolTag(mockIdentity(), 'git_commit'),
      ).rejects.toThrow('Built-in tools cannot be modified');
    });

    it('deletes a custom tool', async () => {
      const pool = {
        query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
      };

      const service = new ToolTagService(pool as never);
      await service.deleteToolTag(mockIdentity(), 'my_tool');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('DELETE FROM tool_tags');
      expect(params).toEqual(['tenant-1', 'my_tool']);
    });

    it('throws when tool is not found', async () => {
      const pool = {
        query: vi.fn(async () => ({ rowCount: 0, rows: [] })),
      };

      const service = new ToolTagService(pool as never);

      await expect(
        service.deleteToolTag(mockIdentity(), 'nonexistent'),
      ).rejects.toThrow('Tool not found');
    });
  });
});
