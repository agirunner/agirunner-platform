import { describe, expect, it, vi } from 'vitest';

import { ConflictError, ValidationError } from '../../src/errors/domain-errors.js';
import { HandoffService } from '../../src/services/handoff-service.js';

describe('HandoffService', () => {
  it('submits a structured task handoff with sequenced persistence', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 3,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            review_focus: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      review_focus: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'handoff-1',
        role: 'developer',
        sequence: 3,
        review_focus: ['error handling'],
      }),
    );
  });

  it('serializes jsonb handoff fields before inserting them', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'task-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          role: 'developer',
          stage_name: 'implementation',
          metadata: { team_name: 'delivery' },
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          id: 'handoff-1',
          tenant_id: 'tenant-1',
          workflow_id: 'workflow-1',
          work_item_id: 'work-item-1',
          task_id: 'task-1',
          request_id: 'req-2',
          role: 'developer',
          team_name: 'delivery',
          stage_name: 'implementation',
          sequence: 0,
          summary: 'Captured implementation handoff.',
          completion: 'partial',
          changes: ['requirements summary'],
          decisions: [{ owner: 'developer' }],
          remaining_items: ['review findings'],
          blockers: ['Need human scope confirmation'],
          review_focus: ['edge cases'],
          known_risks: ['late requirement drift'],
          successor_context: 'Keep the release scope minimal.',
          role_data: { branch: 'feature/hello-world' },
          artifact_ids: [],
          created_at: new Date('2026-03-15T12:00:00Z'),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-2',
      summary: 'Captured implementation handoff.',
      completion: 'partial',
      changes: ['requirements summary'],
      decisions: [{ owner: 'developer' }],
      remaining_items: ['review findings'],
      blockers: ['Need human scope confirmation'],
      review_focus: ['edge cases'],
      known_risks: ['late requirement drift'],
      successor_context: 'Keep the release scope minimal.',
      role_data: { branch: 'feature/hello-world' },
    });

    const insertParams = query.mock.calls[2][1] as unknown[];
    expect(insertParams[4]).toBe(0);
    expect(insertParams[12]).toBe(JSON.stringify(['requirements summary']));
    expect(insertParams[13]).toBe(JSON.stringify([{ owner: 'developer' }]));
    expect(insertParams[14]).toBe(JSON.stringify(['review findings']));
    expect(insertParams[15]).toBe(JSON.stringify(['Need human scope confirmation']));
    expect(insertParams[19]).toBe(JSON.stringify({ branch: 'feature/hello-world' }));
  });

  it('returns the existing handoff for an idempotent request replay', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            review_focus: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Implemented auth flow.',
      completion: 'full',
      changes: [{ file: 'src/auth.ts' }],
      review_focus: ['error handling'],
      successor_context: 'Focus on refresh token expiry.',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', request_id: 'req-1' }));
  });

  it('rejects a replay when the existing handoff payload differs', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'developer',
            stage_name: 'implementation',
            metadata: { team_name: 'delivery' },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [{ file: 'src/auth.ts' }],
            decisions: [],
            remaining_items: [],
            blockers: [],
            review_focus: ['error handling'],
            known_risks: [],
            successor_context: 'Focus on refresh token expiry.',
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.submitTaskHandoff('tenant-1', 'task-1', {
        request_id: 'req-1',
        summary: 'Different summary',
        completion: 'full',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('loads the predecessor handoff for a task-scoped chain', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'task-2',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            role: 'reviewer',
            stage_name: 'review',
            metadata: {},
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 'handoff-1',
            tenant_id: 'tenant-1',
            workflow_id: 'workflow-1',
            work_item_id: 'work-item-1',
            task_id: 'task-1',
            request_id: 'req-1',
            role: 'developer',
            team_name: 'delivery',
            stage_name: 'implementation',
            sequence: 0,
            summary: 'Implemented auth flow.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            review_focus: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
          rowCount: 1,
        }),
    };

    const service = new HandoffService(pool as never);
    const result = await service.getPredecessorHandoff('tenant-1', 'task-2');

    expect(result).toEqual(expect.objectContaining({ id: 'handoff-1', role: 'developer' }));
  });

  it('requires a structured handoff before completion when the playbook mandates it', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              process_instructions: 'Developer implements and reviewer reviews.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
            },
          }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        role: 'developer',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('requires a fresh structured handoff for the current rework iteration before completion', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            definition: {
              process_instructions: 'Developer implements and reviewer reviews.',
              roles: ['developer', 'reviewer'],
              board: { columns: [{ id: 'planned', label: 'Planned' }] },
              handoff_rules: [{ from_role: 'developer', to_role: 'reviewer', required: true }],
            },
          }],
          rowCount: 1,
        })
        .mockImplementationOnce(async (sql: string) => {
          if (sql.includes('task_rework_count')) {
            return { rows: [], rowCount: 0 };
          }
          return { rows: [{ id: 'handoff-0' }], rowCount: 1 };
        }),
    };

    const service = new HandoffService(pool as never);

    await expect(
      service.assertRequiredTaskHandoffBeforeCompletion('tenant-1', {
        id: 'task-1',
        workflow_id: 'workflow-1',
        role: 'developer',
        rework_count: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
