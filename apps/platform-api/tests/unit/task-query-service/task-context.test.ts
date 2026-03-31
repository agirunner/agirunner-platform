import { describe, expect, it, vi } from 'vitest';

import { TaskQueryService } from '../../../src/services/task-query-service.js';
import { taskId, tenantId } from './support.js';

describe('TaskQueryService task context redaction', () => {
  it('redacts plaintext secrets and secret refs from git activity and task context responses', async () => {
    const queries = vi.fn(async (sql: string) => {
      if (sql.includes('FROM tasks') && sql.includes('WHERE tenant_id = $1 AND id = $2')) {
        return {
          rowCount: 1,
          rows: [{
            id: taskId,
            tenant_id: tenantId,
            assigned_agent_id: 'agent-1',
            workflow_id: 'workflow-1',
            workspace_id: 'workspace-1',
            work_item_id: 'wi-1',
            depends_on: [],
            input: {
              credentials: { api_key: 'sk-top-secret', secret_ref: 'secret:API_KEY' },
              instructions: 'Use secret:TASK_PROMPT_TOKEN when contacting the service.',
            },
            role_config: {
              llm_api_key: 'plaintext-key',
              instructions: 'Role instructions reference secret:ROLE_API_KEY for auth.',
            },
            context: { oauth: { access_token: 'plaintext-access-token' } },
            git_info: {
              linked_prs: [{ id: 7 }],
              extra_headers: { Authorization: 'Bearer header.payload.signature' },
              nested: { token_ref: 'secret:GIT_TOKEN' },
            },
          }],
        };
      }
      if (sql.includes('FROM agents')) {
        return {
          rows: [{
            id: 'agent-1',
            name: 'Agent One',
            metadata: {
              profile: {
                name: 'Agent One',
                instructions: 'Use the platform prompt plus a concise review loop.',
              },
            },
          }],
        };
      }
      if (sql.includes('FROM workspaces')) {
        return {
          rows: [{
            id: 'workspace-1',
            name: 'Workspace',
            description: 'Desc',
            memory: { deployment_token: 'deploy-secret' },
          }],
        };
      }
      if (sql.includes('FROM workflows p')) {
        return {
          rows: [{
            id: 'workflow-1',
            name: 'Workflow',
            lifecycle: 'ongoing',
            context: { auth: { password: 'workflow-password' } },
            git_branch: 'main',
            parameters: { secret_ref: 'secret:SAFE' },
            resolved_config: { provider_token: 'provider-secret' },
            instruction_config: {},
            metadata: {},
            playbook_id: 'pb-1',
            workspace_spec_version: null,
            playbook_name: 'Playbook',
            playbook_outcome: 'Done',
            playbook_definition: {},
          }],
        };
      }
      if (sql.includes('FROM task_handoffs')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'handoff-ctx-1',
            workflow_id: 'workflow-1',
            work_item_id: 'wi-1',
            task_id: 'task-upstream-1',
            role: 'developer',
            stage_name: 'implementation',
            sequence: 4,
            summary: 'Implementation is ready for review.',
            completion: 'full',
            changes: [],
            decisions: [],
            remaining_items: [],
            blockers: [],
            focus_areas: [],
            known_risks: [],
            successor_context: null,
            role_data: {},
            artifact_ids: [],
            created_at: new Date('2026-03-15T12:00:00Z'),
          }],
        };
      }
      if (sql.includes('SELECT workspace_id, workspace_spec_version') && sql.includes('FROM workflows')) {
        return {
          rowCount: 1,
          rows: [{ workspace_id: 'workspace-1', workspace_spec_version: 1 }],
        };
      }
      if (sql.includes('FROM workspace_spec_versions')) {
        return {
          rowCount: 1,
          rows: [{ spec: {} }],
        };
      }
      if (sql.includes('FROM workflow_documents')) {
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes('SELECT DISTINCT stage_name')) return { rows: [] };
      if (sql.includes('FROM workflow_work_items')) {
        return {
          rows: [{
            id: 'wi-1',
            stage_name: 'build',
            column_id: 'todo',
            title: 'Item',
            metadata: { webhook_url: 'https://hooks.slack.com/services/secret' },
          }],
        };
      }
      return { rows: [] };
    });
    const logService = { insert: vi.fn().mockResolvedValue(undefined) };
    const service = new TaskQueryService({ query: queries } as never, logService as never);

    const git = await service.getTaskGitActivity(tenantId, taskId);
    const context = await service.getTaskContext(tenantId, taskId);

    expect((git.raw as Record<string, any>).extra_headers.Authorization).toBe('redacted://task-secret');
    expect((git.raw as Record<string, any>).nested.token_ref).toBe('redacted://task-secret');
    expect((context.workspace as Record<string, any>).memory.deployment_token).toBe('redacted://task-context-secret');
    expect((context.workflow as Record<string, any>).resolved_config.provider_token).toBe('redacted://task-context-secret');
    expect((context.workflow as Record<string, any>).variables.secret_ref).toBe('redacted://task-context-secret');
    expect((context.task as Record<string, any>).input.credentials.api_key).toBe('redacted://task-context-secret');
    expect((context.task as Record<string, any>).input.credentials.secret_ref).toBe('redacted://task-context-secret');
    expect((context.task as Record<string, any>).context.oauth.access_token).toBe('redacted://task-context-secret');
    expect(context.instructions).toBe('redacted://task-context-secret');
    expect(((context.instruction_layers as Record<string, any>).role as Record<string, any>).content).toBe(
      'redacted://task-context-secret',
    );
    expect(((context.instruction_layers as Record<string, any>).task as Record<string, any>).content).toBe(
      'redacted://task-context-secret',
    );
    expect(logService.insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operation: 'task.context.predecessor_handoff.attach',
        taskId,
        workflowId: 'workflow-1',
        workItemId: 'wi-1',
        payload: expect.objectContaining({
          current_workflow_id: 'workflow-1',
          current_work_item_id: 'wi-1',
          current_task_id: taskId,
          resolution_source: 'local_work_item',
          has_predecessor_handoff: true,
          candidate_handoff_ids: ['handoff-ctx-1'],
          candidate_task_ids: ['task-upstream-1'],
          selected_handoff_id: 'handoff-ctx-1',
          selected_handoff_workflow_id: 'workflow-1',
          selected_handoff_work_item_id: 'wi-1',
          selected_handoff_role: 'developer',
          selected_handoff_sequence: 4,
        }),
      }),
    );
    expect(logService.insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: 'task.context.attachments',
        taskId,
        workflowId: 'workflow-1',
        workItemId: 'wi-1',
        payload: expect.objectContaining({
          agent_profile_present: true,
          agent_profile_hash: expect.any(String),
          agent_profile_instructions_present: true,
          agent_profile_instructions_hash: expect.any(String),
          instruction_context_version: 1,
          instruction_layers_hash: expect.any(String),
          flattened_system_prompt_hash: expect.any(String),
          instruction_layer_hashes: expect.objectContaining({
            role: expect.any(String),
            task: expect.any(String),
          }),
          instruction_layer_versions: expect.objectContaining({
            role: null,
            task: taskId,
          }),
          predecessor_handoff_present: true,
          predecessor_handoff_resolution_present: true,
          predecessor_handoff_source: 'local_work_item',
          recent_handoff_count: 1,
          work_item_continuity_present: true,
          workspace_memory_index_present: true,
          workspace_artifact_index_present: true,
          document_count: 0,
        }),
      }),
    );
  });
});
