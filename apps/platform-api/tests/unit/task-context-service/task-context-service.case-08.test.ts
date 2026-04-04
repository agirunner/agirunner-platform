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
  it('includes workflow input packets in the workflow context', async () => {
    const storage = {
      getObject: vi.fn(async () => ({
        contentType: 'text/plain',
        data: Buffer.from('deploy checklist'),
      })),
    };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-packets',
                name: 'Packet workflow',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-packets',
                playbook_name: 'Packet playbook',
                playbook_outcome: 'Ship work',
                playbook_definition: {
                  lifecycle: 'planned',
                  stages: [{ name: 'implementation', goal: 'Build it' }],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM workflow_input_packets')) {
          expect(sql).not.toContain('LIMIT 20');
          return {
            rows: [
              {
                id: 'packet-1',
                work_item_id: null,
                packet_kind: 'supplemental',
                source: 'operator',
                summary: 'Added a deployment checklist',
                structured_inputs: { environment: 'staging' },
                metadata: {},
                created_at: new Date('2026-03-27T10:00:00.000Z'),
              },
            ],
          };
        }
        if (sql.includes('FROM workflow_input_packet_files')) {
          return {
            rows: [
              {
                id: 'packet-file-1',
                packet_id: 'packet-1',
                file_name: 'checklist.txt',
                description: 'Deployment checklist',
                storage_key: 'tenants/tenant-1/workflows/workflow-packets/input-packets/packet-1/files/packet-file-1/checklist.txt',
                content_type: 'text/plain',
                size_bytes: 42,
                created_at: new Date('2026-03-27T10:00:00.000Z'),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(
      db as never,
      'tenant-1',
      {
        id: 'task-packets',
        workflow_id: 'workflow-packets',
        depends_on: [],
      },
      undefined,
      storage as never,
    );

    const workflow = context.workflow as Record<string, unknown>;
    expect(workflow).toHaveProperty('input_packets');
    expect(workflow.input_packets).toEqual([
      expect.objectContaining({
        id: 'packet-1',
        packet_kind: 'supplemental',
        files: [
          expect.objectContaining({
            id: 'packet-file-1',
            file_name: 'checklist.txt',
            context_file: {
              path: '/workspace/context/input-packets/packet-1/files/packet-file-1/checklist.txt',
              content_base64: Buffer.from('deploy checklist').toString('base64'),
            },
          }),
        ],
      }),
    ]);
    expect(workflow.input_packets).not.toEqual([
      expect.objectContaining({
        files: [expect.objectContaining({ download_url: expect.any(String) })],
      }),
    ]);
    expect(storage.getObject).toHaveBeenCalledWith(
      'tenants/tenant-1/workflows/workflow-packets/input-packets/packet-1/files/packet-file-1/checklist.txt',
    );
  });

});
