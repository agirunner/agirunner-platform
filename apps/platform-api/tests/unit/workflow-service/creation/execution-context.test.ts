import { describe, expect, it } from 'vitest';

import {
  createClient,
  createPlaybookDefinition,
  createPlaybookRow,
  createWorkflowCreationService,
  IDENTITY,
  isTransactionControl,
} from './support.js';

describe('WorkflowCreationService execution context', () => {
  it('persists workflow execution context and attempt lineage when provided', async () => {
    const client = createClient();
    client.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return { rowCount: 1, rows: [createPlaybookRow(createPlaybookDefinition())] };
      }
      if (sql.includes('INSERT INTO workflows')) {
        expect(params?.[15]).toBe('enhanced');
        expect(params?.[16]).toBe(1);
        expect(params?.[17]).toBe('tenant-1');
        expect(params?.[18]).toEqual({
          launch: { trigger: 'mission_control' },
          redrive: { source_workflow_id: 'workflow-1' },
        });
        expect(params?.[19]).toBe(
          Buffer.byteLength(
            JSON.stringify({
              launch: { trigger: 'mission_control' },
              redrive: { source_workflow_id: 'workflow-1' },
            }),
            'utf8',
          ),
        );
        expect(params?.[20]).toBe(null);
        expect(params?.[21]).toBe('workflow-1');
        expect(params?.[22]).toBe('workflow-1');
        expect(params?.[23]).toBe(2);
        expect(params?.[24]).toBe('redrive');
        return {
          rowCount: 1,
          rows: [{
            id: 'workflow-2',
            playbook_id: 'playbook-1',
            lifecycle: 'planned',
            current_stage: 'implementation',
            context: params?.[18],
            live_visibility_mode_override: params?.[15],
            attempt_group_id: params?.[20],
            root_workflow_id: params?.[21],
            previous_attempt_workflow_id: params?.[22],
            attempt_number: params?.[23],
            attempt_kind: params?.[24],
          }],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client);
    const result = await service.createWorkflow(IDENTITY as never, {
      playbook_id: 'playbook-1',
      name: 'Workflow Retry',
      context: {
        launch: { trigger: 'mission_control' },
        redrive: { source_workflow_id: 'workflow-1' },
      },
      attempt: {
        root_workflow_id: 'workflow-1',
        previous_attempt_workflow_id: 'workflow-1',
        attempt_number: 2,
        attempt_kind: 'redrive',
      },
      live_visibility_mode: 'enhanced',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'workflow-2',
        context: {
          launch: { trigger: 'mission_control' },
          redrive: { source_workflow_id: 'workflow-1' },
        },
        attempt_group_id: null,
        root_workflow_id: 'workflow-1',
        previous_attempt_workflow_id: 'workflow-1',
        attempt_number: 2,
        attempt_kind: 'redrive',
        live_visibility_mode_override: 'enhanced',
      }),
    );
  });
});
