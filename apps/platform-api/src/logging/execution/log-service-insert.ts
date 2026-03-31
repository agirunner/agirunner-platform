import type { DatabasePool, DatabaseQueryable } from '../../db/database.js';
import {
  MAX_BATCH_SIZE,
  MAX_REJECTION_DETAILS,
} from './log-service-constants.js';
import {
  formatBatchInsertError,
  isDuplicateExecutionLogPartitionError,
  isMissingExecutionLogPartitionError,
  partitionDateFor,
} from './log-service-db-errors.js';
import { buildInsertValues } from './log-service-insert-values.js';
import type {
  ExecutionLogEntry,
  LogBatchRejectionDetail,
  LogLevelFilter,
} from './log-service-types.js';

export interface LogPartitionState {
  ensuredPartitionDates: Set<string>;
  ensuringPartitionDates: Map<string, Promise<void>>;
}

export interface LogWriteContext {
  pool: DatabasePool;
  levelFilter: LogLevelFilter | null;
  partitions: LogPartitionState;
}

const INSERT_LOG_ROW_SQL = `INSERT INTO execution_logs (
        tenant_id, trace_id, span_id, parent_span_id,
        source, category, level, operation, status, duration_ms,
        payload, error,
        workspace_id, workflow_id, workflow_name, workspace_name, task_id,
        work_item_id, activation_id, task_title, stage_name, is_orchestrator_task,
        execution_backend, tool_owner,
        role,
        actor_type, actor_id, actor_name,
        resource_type, resource_id, resource_name,
        created_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24,
        $25,
        $26, $27, $28,
        $29, $30, $31,
        COALESCE($32::timestamptz, now())
      )`;

export async function insertLogEntry(
  context: LogWriteContext,
  executor: DatabaseQueryable,
  entry: ExecutionLogEntry,
): Promise<void> {
  if (context.levelFilter) {
    const shouldWrite = await context.levelFilter.shouldWrite(entry.tenantId, entry.level);
    if (!shouldWrite) return;
  }

  const partitionDate = partitionDateFor(entry.createdAt);
  await ensurePartition(context, partitionDate);

  const workflowName = entry.workflowName ?? null;
  const workspaceName = entry.workspaceName ?? null;
  const stageName = entry.stageName ?? null;

  try {
    await insertRow(executor, entry, workflowName, workspaceName, stageName);
  } catch (error) {
    if (!isMissingExecutionLogPartitionError(error)) {
      throw error;
    }
    context.partitions.ensuredPartitionDates.delete(partitionDate);
    await ensurePartition(context, partitionDate);
    await insertRow(executor, entry, workflowName, workspaceName, stageName);
  }
}

export async function insertBatchEntries(
  context: LogWriteContext,
  entries: ExecutionLogEntry[],
): Promise<{
  accepted: number;
  rejected: number;
  rejection_details: LogBatchRejectionDetail[];
}> {
  if (entries.length === 0) return { accepted: 0, rejected: 0, rejection_details: [] };

  const batch = entries.slice(0, MAX_BATCH_SIZE);
  let accepted = 0;
  let rejected = 0;
  const rejectionDetails: LogBatchRejectionDetail[] = [];

  for (const [index, entry] of batch.entries()) {
    try {
      await insertLogEntry(context, context.pool, entry);
      accepted += 1;
    } catch (error) {
      rejected += 1;
      if (rejectionDetails.length < MAX_REJECTION_DETAILS) {
        rejectionDetails.push({
          index,
          trace_id: entry.traceId,
          operation: entry.operation,
          reason: formatBatchInsertError(error),
        });
      }
    }
  }

  return { accepted, rejected, rejection_details: rejectionDetails };
}

async function insertRow(
  executor: DatabaseQueryable,
  entry: ExecutionLogEntry,
  workflowName: string | null,
  workspaceName: string | null,
  stageName: string | null,
): Promise<void> {
  await executor.query(
    INSERT_LOG_ROW_SQL,
    buildInsertValues(entry, workflowName, workspaceName, stageName),
  );
}

async function ensurePartition(
  context: LogWriteContext,
  partitionDate: string,
): Promise<void> {
  if (context.partitions.ensuredPartitionDates.has(partitionDate)) {
    return;
  }
  const existing = context.partitions.ensuringPartitionDates.get(partitionDate);
  if (existing) {
    await existing;
    return;
  }

  const ensurePromise = createPartition(context.pool, partitionDate);
  context.partitions.ensuringPartitionDates.set(partitionDate, ensurePromise);

  try {
    await ensurePromise;
    context.partitions.ensuredPartitionDates.add(partitionDate);
  } finally {
    context.partitions.ensuringPartitionDates.delete(partitionDate);
  }
}

async function createPartition(pool: DatabasePool, partitionDate: string): Promise<void> {
  try {
    await pool.query(`SELECT create_execution_logs_partition($1::date)`, [partitionDate]);
  } catch (error) {
    if (!isDuplicateExecutionLogPartitionError(error)) {
      throw error;
    }
  }
}
