import { describe, expect, it, vi } from 'vitest';

import {
  expectWorkflowStageProjection,
  readInsertedActivationTask,
  WorkflowActivationDispatchService,
} from './test-harness.js';

describe('WorkflowActivationDispatchService', () => {
  it('hydrates orchestrator activation tasks with repository execution defaults', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-repo',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-repo',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow Repo',
              workspace_id: 'workspace-1',
              lifecycle: 'planned',
              current_stage: 'requirements',
              active_stages: [],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship code',
              workspace_repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              workspace_settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              workflow_git_branch: null,
              workflow_parameters: {
                branch: 'main',
                feature_branch: 'smoke/feature-1',
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-repo',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-repo',
              request_id: 'req-repo',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-repo',
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: new Date('2026-03-12T00:00:01Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(inserted.roleConfig).toEqual(
            expect.objectContaining({
              system_prompt: expect.any(String),
            }),
          );
          expect((inserted.roleConfig as { system_prompt: string }).system_prompt.length).toBeGreaterThan(0);
          expect(inserted.environment).toEqual({
            execution_mode: 'orchestrator',
            template: 'execution-workspace',
            repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
            branch: 'main',
            git_user_name: 'Smoke Bot',
            git_user_email: 'smoke@example.test',
          });
          expect(JSON.parse(String(inserted.resourceBindings ?? '[]'))).toEqual([
            {
              type: 'git_repository',
              repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              credentials: {
                token: 'secret:GITHUB_PAT',
              },
            },
          ]);
          expect(inserted.input).toEqual(
            expect.objectContaining({
              current_stage: 'requirements',
              description: expect.stringContaining('Active subordinate work means real workflow work items and non-orchestrator specialist tasks'),
              repository: {
                repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
                base_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
              },
            }),
          );
          expect((inserted.input as { description: string }).description).toContain(
            'If a planned successor stage or human gate can start now, apply that routing or gate mutation before submit_handoff.',
          );
          expect((inserted.input as { description: string }).description).toContain(
            'Do not describe the workflow as waiting on a successor stage or human approval until the corresponding create_work_item, create_task, or request_gate_approval call has succeeded.',
          );
          return { rowCount: 1, rows: [{ id: 'task-repo' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    expectWorkflowStageProjection({ currentStage: 'requirements' });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-repo');

    expect(taskId).toBe('task-repo');
  });

  it('ignores branch-only workflow input and keeps the workspace branch policy', async () => {
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes("state = 'processing'") && sql.includes('id = activation_id')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflow_activations') && sql.includes('FOR UPDATE SKIP LOCKED')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-branch-only',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: null,
              request_id: 'req-branch-only',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'queued',
              dispatch_attempt: 0,
              dispatch_token: null,
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: null,
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('FROM tasks') && sql.includes('is_orchestrator_task = true')) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes('FROM workflows w') && sql.includes('JOIN playbooks p')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'workflow-1',
              name: 'Workflow Repo',
              workspace_id: 'workspace-1',
              lifecycle: 'planned',
              current_stage: 'requirements',
              active_stages: [],
              playbook_id: 'playbook-1',
              playbook_name: 'SDLC',
              playbook_outcome: 'Ship code',
              workspace_repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
              workspace_settings: {
                default_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
                credentials: {
                  git_token: 'secret:GITHUB_PAT',
                },
              },
              workflow_git_branch: null,
              workflow_parameters: {
                branch: 'feature/hello-world',
              },
            }],
          };
        }
        if (sql.includes('SET activation_id = $3')) {
          return {
            rowCount: 1,
            rows: [{
              id: 'activation-branch-only',
              tenant_id: 'tenant-1',
              workflow_id: 'workflow-1',
              activation_id: 'activation-branch-only',
              request_id: 'req-branch-only',
              reason: 'workflow.created',
              event_type: 'workflow.created',
              payload: { stage_name: 'requirements' },
              state: 'processing',
              dispatch_attempt: 1,
              dispatch_token: 'dispatch-token-branch-only',
              queued_at: new Date('2026-03-12T00:00:00Z'),
              started_at: new Date('2026-03-12T00:00:01Z'),
              consumed_at: null,
              completed_at: null,
              summary: null,
              error: null,
            }],
          };
        }
        if (sql.includes('INSERT INTO tasks')) {
          const inserted = readInsertedActivationTask(params);
          expect(inserted.environment).toEqual({
            execution_mode: 'orchestrator',
            template: 'execution-workspace',
            repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
            branch: 'main',
            git_user_name: 'Smoke Bot',
            git_user_email: 'smoke@example.test',
          });
          expect(inserted.input).toEqual(
            expect.objectContaining({
              repository: {
                repository_url: 'https://github.com/agisnap/agirunner-test-fixtures.git',
                base_branch: 'main',
                git_user_name: 'Smoke Bot',
                git_user_email: 'smoke@example.test',
              },
            }),
          );
          return { rowCount: 1, rows: [{ id: 'task-branch-only' }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(),
    };

    const service = new WorkflowActivationDispatchService({
      pool: { connect: vi.fn(async () => client) } as never,
      eventService: { emit: vi.fn(async () => undefined) } as never,
      config: {
        TASK_DEFAULT_TIMEOUT_MINUTES: 30,
        WORKFLOW_ACTIVATION_DELAY_MS: 60_000,
        WORKFLOW_ACTIVATION_STALE_AFTER_MS: 300_000,
      },
    });
    expectWorkflowStageProjection({ currentStage: 'requirements' });

    const taskId = await service.dispatchActivation('tenant-1', 'activation-branch-only');

    expect(taskId).toBe('task-branch-only');
  });
});
