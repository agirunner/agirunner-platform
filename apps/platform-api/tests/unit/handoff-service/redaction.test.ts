import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { HandoffService } from '../../../src/services/handoff-service/handoff-service.js';
import { makeTaskRow } from './handoff-service.fixtures.js';

describe('HandoffService redaction', () => {
  it('rejects handoffs that reference ephemeral task-local paths', async () => {
    const pool = {
      query: vi.fn().mockResolvedValueOnce({ rows: [makeTaskRow()], rowCount: 1 }),
    };

    const service = new HandoffService(pool as never);

    await expect(service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Drafted the PRD in output/requirements/prd.md and it is ready for review.',
      completion: 'full',
      changes: ['Created PRD markdown at output/requirements/prd.md.'],
      successor_context: 'Read output/requirements/prd.md before reviewing it.',
    })).rejects.toThrowError(
      new ValidationError(
        'Structured handoffs must not reference task-local path "output/requirements/prd.md". Persist output to artifacts/repo/memory and reference artifact ids/logical paths, repo-relative paths, memory keys, and workflow/task ids instead',
      ),
    );

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('repairs uploaded output references into stable handoff wording when artifact ids are present', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [makeTaskRow()], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockImplementationOnce(async (_sql: string, params?: unknown[]) => ({
          rows: [{
            ...makeTaskRow(),
            id: 'handoff-1',
            task_id: 'task-1',
            request_id: 'req-1',
            summary: String(params?.[10]),
            changes: JSON.parse(String(params?.[15])),
            successor_context: String(params?.[21]),
            artifact_ids: ['artifact-1'],
            created_at: new Date('2026-03-28T02:00:00.000Z'),
          }],
          rowCount: 1,
        })),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary: 'Recorded the triage packet in output/workflows-intake-01-triage.md for review.',
      completion: 'full',
      changes: ['Created triage packet at output/workflows-intake-01-triage.md.'],
      successor_context: 'Inspect output/workflows-intake-01-triage.md next.',
      artifact_ids: ['artifact-1'],
    });

    expect(result.summary).toBe(
      'Recorded the triage packet in uploaded artifact workflows-intake-01-triage.md for review.',
    );
    expect(result.changes).toEqual([
      'Created triage packet at uploaded artifact workflows-intake-01-triage.md.',
    ]);
    expect(result.successor_context).toBe(
      'Inspect uploaded artifact workflows-intake-01-triage.md next.',
    );
  });

  it('repairs task-local output references when the handoff already cites a stable artifact logical path', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [makeTaskRow()], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ next_sequence: 1 }], rowCount: 1 })
        .mockImplementationOnce(async (_sql: string, params?: unknown[]) => ({
          rows: [{
            ...makeTaskRow(),
            id: 'handoff-1',
            task_id: 'task-1',
            request_id: 'req-1',
            summary: String(params?.[10]),
            changes: JSON.parse(String(params?.[15])),
            successor_context: String(params?.[21]),
            artifact_ids: [],
            created_at: new Date('2026-03-28T02:00:00.000Z'),
          }],
          rowCount: 1,
        })),
    };

    const service = new HandoffService(pool as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-1',
      summary:
        'Delivered a triage packet. The persisted deliverable is uploaded as artifact artifact:workflow/output/triage-export-retention-clarification.md, with the working file retained at output/triage-export-retention-clarification.md during execution.',
      completion: 'full',
      changes: [
        'Created output/triage-export-retention-clarification.md with the triage summary.',
        'Uploaded the deliverable as artifact artifact:workflow/output/triage-export-retention-clarification.md for downstream review.',
      ],
      successor_context:
        'Review artifact:workflow/output/triage-export-retention-clarification.md instead of output/triage-export-retention-clarification.md.',
    });

    expect(result.summary).not.toContain('retained at output/');
    expect(result.summary).toContain('uploaded artifact triage-export-retention-clarification.md');
    expect(result.changes).toEqual([
      'Created uploaded artifact triage-export-retention-clarification.md with the triage summary.',
      'Uploaded the deliverable as artifact artifact:workflow/output/triage-export-retention-clarification.md for downstream review.',
    ]);
    expect(result.successor_context).toBe(
      'Review artifact:workflow/output/triage-export-retention-clarification.md instead of uploaded artifact triage-export-retention-clarification.md.',
    );
  });

  it('redacts secret-like handoff content before persistence and in returned rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [makeTaskRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ next_sequence: 0 }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{
          ...makeTaskRow(),
          id: 'handoff-secret-1',
          task_id: 'task-1',
          request_id: 'req-secret-1',
          summary: 'sk-runtime-secret',
          changes: [{ api_key: 'sk-runtime-secret' }],
          decisions: [{ authorization: 'Bearer handoff-secret' }],
          remaining_items: ['sk-runtime-secret'],
          blockers: [{ token: 'sk-runtime-secret' }],
          focus_areas: ['sk-runtime-secret'],
          known_risks: ['Bearer handoff-secret'],
          successor_context: 'Bearer handoff-secret',
          role_data: { api_key: 'sk-runtime-secret' },
          created_at: new Date('2026-03-15T12:00:00Z'),
        }],
        rowCount: 1,
      });

    const service = new HandoffService({ query } as never);

    const result = await service.submitTaskHandoff('tenant-1', 'task-1', {
      request_id: 'req-secret-1',
      summary: 'sk-runtime-secret',
      completion: 'full',
      changes: [{ api_key: 'sk-runtime-secret' }],
      decisions: [{ authorization: 'Bearer handoff-secret' }],
      remaining_items: ['sk-runtime-secret'],
      blockers: [{ token: 'sk-runtime-secret' }],
      focus_areas: ['sk-runtime-secret'],
      known_risks: ['Bearer handoff-secret'],
      successor_context: 'Bearer handoff-secret',
      role_data: { api_key: 'sk-runtime-secret' },
    });

    const insertParams = query.mock.calls[4][1] as unknown[];
    expect(insertParams[10]).toBe('redacted://handoff-secret');
    expect(insertParams[15]).toBe(JSON.stringify([{ api_key: 'redacted://handoff-secret' }]));
    expect(insertParams[16]).toBe(
      JSON.stringify([{ authorization: 'redacted://handoff-secret' }]),
    );
    expect(insertParams[17]).toBe(JSON.stringify(['redacted://handoff-secret']));
    expect(insertParams[18]).toBe(JSON.stringify([{ token: 'redacted://handoff-secret' }]));
    expect(insertParams[19]).toEqual(['redacted://handoff-secret']);
    expect(insertParams[20]).toEqual(['redacted://handoff-secret']);
    expect(insertParams[21]).toBe('redacted://handoff-secret');
    expect(insertParams[22]).toBe(
      JSON.stringify({
        api_key: 'redacted://handoff-secret',
        task_kind: 'delivery',
        subject_task_id: 'task-1',
        subject_work_item_id: 'work-item-1',
        subject_revision: 1,
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        summary: 'redacted://handoff-secret',
        changes: [{ api_key: 'redacted://handoff-secret' }],
        decisions: [{ authorization: 'redacted://handoff-secret' }],
        remaining_items: ['redacted://handoff-secret'],
        blockers: [{ token: 'redacted://handoff-secret' }],
        focus_areas: ['redacted://handoff-secret'],
        known_risks: ['redacted://handoff-secret'],
        successor_context: 'redacted://handoff-secret',
        role_data: { api_key: 'redacted://handoff-secret' },
      }),
    );
  });
});
