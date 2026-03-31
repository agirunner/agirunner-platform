import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseQueryable } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { sanitizeOptionalText, sanitizeRequiredText } from './workflow-operator-record-sanitization.js';

interface TaskExecutionContextRow {
  id: string;
  workflow_id: string;
  work_item_id: string | null;
  is_orchestrator_task: boolean;
  role: string | null;
  state: string;
}

interface ActivationExecutionContextRow {
  id: string;
  workflow_id: string;
  activation_id: string | null;
  state: string;
  consumed_at: Date | null;
}

const OPERATOR_RECORD_TASK_STATES = [
  'claimed',
  'in_progress',
  'output_pending_assessment',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
  'escalated',
] as const;

export interface WorkflowOperatorExecutionContextInput {
  executionContextId: string;
  sourceKind?: string;
  sourceRoleName?: string;
  workItemId?: string;
  taskId?: string;
}

export interface ResolvedWorkflowOperatorExecutionContext {
  executionContextId: string;
  sourceKind: string;
  sourceRoleName: string | null;
  workItemId: string | null;
  taskId: string | null;
}

export async function resolveWorkflowOperatorExecutionContext(
  pool: DatabaseQueryable,
  identity: ApiKeyIdentity,
  workflowId: string,
  input: WorkflowOperatorExecutionContextInput,
): Promise<ResolvedWorkflowOperatorExecutionContext> {
  const executionContextId = sanitizeRequiredText(
    input.executionContextId,
    'Workflow operator record execution context id is required',
  );
  const sourceKind = sanitizeOptionalText(input.sourceKind);
  if (isPlatformWrite(identity, sourceKind)) {
    return {
      executionContextId,
      sourceKind: 'platform',
      sourceRoleName: sanitizeOptionalText(input.sourceRoleName) ?? 'Platform',
      workItemId: sanitizeOptionalText(input.workItemId),
      taskId: sanitizeOptionalText(input.taskId),
    };
  }

  const taskMatch = await readTaskExecutionContext(pool, identity.tenantId, workflowId, executionContextId);
  if (taskMatch) {
    return resolveTaskExecutionContext(taskMatch, input, executionContextId);
  }

  const activationMatch = await readActivationExecutionContext(
    pool,
    identity.tenantId,
    workflowId,
    executionContextId,
  );
  if (activationMatch) {
    return resolveActivationExecutionContext(input, executionContextId);
  }

  throw new ValidationError('Workflow operator record execution context must match a workflow task or activation');
}

function isPlatformWrite(identity: ApiKeyIdentity, sourceKind: string | null): boolean {
  return identity.ownerType === 'system' && sourceKind === 'platform';
}

async function readTaskExecutionContext(
  pool: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  executionContextId: string,
): Promise<TaskExecutionContextRow | null> {
  const result = await pool.query<TaskExecutionContextRow>(
    `SELECT id, workflow_id, work_item_id, is_orchestrator_task, role, state
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND id = $3
        AND state = ANY($4::task_state[])`,
    [tenantId, workflowId, executionContextId, OPERATOR_RECORD_TASK_STATES],
  );
  return result.rows[0] ?? null;
}

async function readActivationExecutionContext(
  pool: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  executionContextId: string,
): Promise<ActivationExecutionContextRow | null> {
  const result = await pool.query<ActivationExecutionContextRow>(
    `SELECT id, workflow_id, activation_id, state, consumed_at
       FROM workflow_activations
      WHERE tenant_id = $1
        AND workflow_id = $2
        AND (id = $3 OR activation_id = $3)
      LIMIT 1`,
    [tenantId, workflowId, executionContextId],
  );
  return result.rows[0] ?? null;
}

function resolveTaskExecutionContext(
  task: TaskExecutionContextRow,
  input: WorkflowOperatorExecutionContextInput,
  executionContextId: string,
): ResolvedWorkflowOperatorExecutionContext {
  const derivedSourceKind = task.is_orchestrator_task ? 'orchestrator' : 'specialist';
  validateExpectedMatch(input.sourceKind, derivedSourceKind, 'source kind');
  validateExpectedMatch(input.taskId, task.id, 'task id');
  validateExpectedNullableMatch(input.workItemId, task.work_item_id, 'work item id');
  return {
    executionContextId,
    sourceKind: derivedSourceKind,
    sourceRoleName: sanitizeOptionalText(input.sourceRoleName) ?? sanitizeOptionalText(task.role),
    workItemId: task.work_item_id,
    taskId: task.id,
  };
}

function resolveActivationExecutionContext(
  input: WorkflowOperatorExecutionContextInput,
  executionContextId: string,
): ResolvedWorkflowOperatorExecutionContext {
  validateExpectedMatch(input.sourceKind, 'orchestrator', 'source kind');
  if (sanitizeOptionalText(input.taskId)) {
    throw new ValidationError('Workflow operator activation-scoped records cannot target a task id');
  }
  return {
    executionContextId,
    sourceKind: 'orchestrator',
    sourceRoleName: sanitizeOptionalText(input.sourceRoleName) ?? 'Orchestrator',
    workItemId: sanitizeOptionalText(input.workItemId),
    taskId: null,
  };
}

function validateExpectedMatch(
  providedValue: string | undefined,
  expectedValue: string,
  fieldLabel: string,
): void {
  const normalized = sanitizeOptionalText(providedValue);
  if (!normalized) {
    return;
  }
  if (normalized !== expectedValue) {
    throw new ValidationError(`Workflow operator record ${fieldLabel} must match the active execution context`);
  }
}

function validateExpectedNullableMatch(
  providedValue: string | undefined,
  expectedValue: string | null,
  fieldLabel: string,
): void {
  const normalized = sanitizeOptionalText(providedValue);
  if (!normalized) {
    return;
  }
  if (!expectedValue || normalized !== expectedValue) {
    throw new ValidationError(`Workflow operator record ${fieldLabel} must match the active execution context`);
  }
}
