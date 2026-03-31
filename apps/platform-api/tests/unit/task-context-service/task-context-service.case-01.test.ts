import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../../src/services/task-context-service/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('keeps continuous workflow active stages work-item driven', async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-1',
                name: 'Continuous workflow',
                lifecycle: 'ongoing',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-1',
                playbook_name: 'Continuous playbook',
                playbook_outcome: 'Ship changes',
                playbook_definition: {
                  lifecycle: 'ongoing',
                  stages: [
                    { name: 'build', goal: 'Build changes' },
                    { name: 'review', goal: 'Review changes' },
                  ],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'build' }] };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-1',
      workflow_id: 'workflow-1',
      depends_on: [],
    });

    expect((context.workflow as Record<string, unknown>).active_stages).toEqual(['build']);
    expect(context.workflow).not.toHaveProperty('current_stage');
    expect(
      queries.some(
        (sql) => sql.includes('FROM workflow_stages') && sql.includes('ORDER BY ws.position ASC'),
      ),
    ).toBe(false);
  });

});
