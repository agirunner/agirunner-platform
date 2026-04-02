import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '../../../src/errors/domain-errors.js';
import { parsePlaybookDefinition } from '../../../src/orchestration/playbook-model.js';
import { assertPlannedStageEntryRoleCanStart } from '../../../src/services/work-item-service/mutation-checks.js';

describe('assertPlannedStageEntryRoleCanStart', () => {
  it('returns machine-readable recovery details when a planned successor stage is seeded with a non-starter role', async () => {
    const definition = parsePlaybookDefinition({
      roles: ['Software Developer', 'Code Reviewer', 'Security Reviewer'],
      lifecycle: 'planned',
      board: {
        columns: [
          { id: 'planned', label: 'Planned' },
          { id: 'done', label: 'Done', is_terminal: true },
        ],
      },
      stages: [
        {
          name: 'implement',
          goal: 'Implement the smallest safe fix.',
          involves: ['Software Developer'],
        },
        {
          name: 'review',
          goal: 'Review the implemented fix.',
          involves: ['Code Reviewer', 'Security Reviewer'],
        },
      ],
    });
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        expect(sql).toContain('FROM workflow_work_items');
        expect(params).toEqual(['tenant-1', 'workflow-1', 'review']);
        return { rowCount: 1, rows: [{ count: 0 }] };
      }),
    };

    await expect(
      assertPlannedStageEntryRoleCanStart(
        'tenant-1',
        'workflow-1',
        definition,
        'review',
        'Software Developer',
        client as never,
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        recovery_hint: 'orchestrator_guided_recovery',
        reason_code: 'planned_stage_starter_role_required',
        stage_name: 'review',
        requested_role: 'Software Developer',
        allowed_starter_roles: ['Code Reviewer', 'Security Reviewer'],
      },
    } satisfies Partial<ValidationError>);
  });
});
