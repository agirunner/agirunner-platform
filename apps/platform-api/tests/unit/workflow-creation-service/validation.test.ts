import { describe, expect, it } from 'vitest';

import {
  createClient,
  createPlaybookDefinition,
  createPlaybookRow,
  createWorkflowCreationService,
  IDENTITY,
  isTransactionControl,
} from './support.js';

describe('WorkflowCreationService validation', () => {
  it('uses workspace terminology when the referenced workspace is missing', async () => {
    const client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return { rowCount: 1, rows: [createPlaybookRow(createPlaybookDefinition())] };
      }
      if (sql.includes('SELECT settings FROM workspaces')) {
        return { rowCount: 0, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client);

    await expect(
      service.createWorkflow(IDENTITY as never, {
        playbook_id: 'playbook-1',
        workspace_id: 'workspace-1',
        name: 'Workflow One',
      }),
    ).rejects.toThrow('Workspace not found');
  });

  it('rejects missing required playbook launch inputs', async () => {
    const client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return {
          rowCount: 1,
          rows: [createPlaybookRow({
            lifecycle: 'planned',
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [{ name: 'delivery', goal: 'Ship the requested outcome.' }],
            roles: ['developer'],
            parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
          })],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client);

    await expect(
      service.createWorkflow(IDENTITY as never, {
        playbook_id: 'playbook-1',
        name: 'Workflow One',
      }),
    ).rejects.toThrow("Missing required playbook launch input 'workflow_goal'.");
  });

  it('rejects undeclared or non-string playbook launch inputs', async () => {
    const client = createClient();
    client.query.mockImplementation(async (sql: string) => {
      if (isTransactionControl(sql)) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT * FROM playbooks')) {
        return {
          rowCount: 1,
          rows: [createPlaybookRow({
            lifecycle: 'planned',
            board: { columns: [{ id: 'planned', label: 'Planned' }] },
            stages: [{ name: 'delivery', goal: 'Ship the requested outcome.' }],
            roles: ['developer'],
            parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: false }],
          })],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });

    const service = createWorkflowCreationService(client);

    await expect(
      service.createWorkflow(IDENTITY as never, {
        playbook_id: 'playbook-1',
        name: 'Workflow One',
        parameters: {
          unexpected_input: 'nope',
        },
      }),
    ).rejects.toThrow("Unknown playbook launch input 'unexpected_input'.");

    await expect(
      service.createWorkflow(IDENTITY as never, {
        playbook_id: 'playbook-1',
        name: 'Workflow One',
        parameters: {
          workflow_goal: 42 as unknown as string,
        },
      }),
    ).rejects.toThrow("Playbook launch input 'workflow_goal' must be a string.");
  });
});
