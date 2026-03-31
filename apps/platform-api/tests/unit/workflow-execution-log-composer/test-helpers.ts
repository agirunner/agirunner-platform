import { posix } from 'node:path';

import {
  buildExecutionTurnItems,
  buildLifecycleHistoryItems,
} from '../../../src/services/workflow-operations/workflow-execution-log-composer.js';

const taskWorkspaceRoot = posix.join('/', 'tmp', 'workspace');

export const taskWorkspacePath = (taskId: string, ...segments: string[]) =>
  posix.join(taskWorkspaceRoot, taskId, ...segments);

export const tempPath = (...segments: string[]) => posix.join('/', 'tmp', ...segments);

export function createLogRow(
  patch: Partial<Parameters<typeof buildExecutionTurnItems>[0][number]> = {},
): Parameters<typeof buildExecutionTurnItems>[0][number] {
  return {
    id: '10',
    tenant_id: 'tenant-1',
    trace_id: 'trace-1',
    span_id: 'span-1',
    parent_span_id: null,
    source: 'runtime',
    category: 'agent_loop',
    level: 'info',
    operation: 'agent.observe',
    status: 'completed',
    duration_ms: 12,
    payload: {},
    error: null,
    workspace_id: 'workspace-1',
    workflow_id: 'workflow-1',
    workflow_name: 'Workflow 1',
    workspace_name: 'Workspace 1',
    task_id: null,
    work_item_id: null,
    stage_name: null,
    activation_id: 'activation-1',
    is_orchestrator_task: false,
    execution_backend: 'runtime_plus_task',
    tool_owner: 'task',
    task_title: 'Assess intake packet',
    role: 'specialist',
    actor_type: 'runtime',
    actor_id: 'runtime',
    actor_name: 'Verifier',
    resource_type: null,
    resource_id: null,
    resource_name: null,
    execution_environment_id: null,
    execution_environment_name: null,
    execution_environment_image: null,
    execution_environment_distro: null,
    execution_environment_package_manager: null,
    created_at: '2026-03-28T10:00:00.000Z',
    ...patch,
  };
}

export {
  buildExecutionTurnItems,
  buildLifecycleHistoryItems,
};
