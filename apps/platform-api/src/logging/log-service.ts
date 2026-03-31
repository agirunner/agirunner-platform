import type { DatabasePool, DatabaseQueryable } from '../db/database.js';
import { insertBatchEntries, insertLogEntry } from './log-service-insert.js';
import type { LogPartitionState } from './log-service-insert.js';
import { exportLogs, getLogById, queryLogs } from './log-service-query.js';
import { queryActorKindValues, queryActors, queryOperations, queryOperationValues, queryRoles, queryRoleValues, queryWorkflowValues } from './log-service-facets.js';
import { queryLogStats } from './log-service-stats.js';

export { decodeCursor, encodeCursor } from './log-service-cursor.js';
export type {
  ActorInfo,
  ActorKindValue,
  ExecutionLogEntry,
  KeysetPage,
  LogBatchRejectionDetail,
  LogFilters,
  LogLevelFilter,
  LogRow,
  LogStats,
  LogStatsFilters,
  LogStatsGroup,
  OperationCount,
  OperationValue,
  RoleValue,
  WorkflowValue,
} from './log-service-types.js';

import type {
  ActorInfo,
  ActorKindValue,
  ExecutionLogEntry,
  KeysetPage,
  LogBatchRejectionDetail,
  LogFilters,
  LogLevelFilter,
  LogRow,
  LogStats,
  LogStatsFilters,
  OperationCount,
  OperationValue,
  RoleValue,
  WorkflowValue,
} from './log-service-types.js';

export class LogService {
  private levelFilter: LogLevelFilter | null = null;
  private readonly partitions: LogPartitionState = {
    ensuredPartitionDates: new Set<string>(),
    ensuringPartitionDates: new Map<string, Promise<void>>(),
  };

  constructor(private readonly pool: DatabasePool) {}

  setLevelFilter(filter: LogLevelFilter): void {
    this.levelFilter = filter;
  }

  async insert(entry: ExecutionLogEntry): Promise<void> {
    await this.insertWithExecutor(this.pool, entry);
  }

  async insertWithExecutor(
    executor: DatabaseQueryable,
    entry: ExecutionLogEntry,
  ): Promise<void> {
    await insertLogEntry(this.writeContext, executor, entry);
  }

  async insertBatch(entries: ExecutionLogEntry[]): Promise<{
    accepted: number;
    rejected: number;
    rejection_details: LogBatchRejectionDetail[];
  }> {
    return insertBatchEntries(this.writeContext, entries);
  }

  async query(tenantId: string, filters: LogFilters): Promise<KeysetPage<LogRow>> {
    return queryLogs(this.pool, tenantId, filters);
  }

  async getById(tenantId: string, id: string): Promise<LogRow | null> {
    return getLogById(this.pool, tenantId, id);
  }

  async stats(tenantId: string, filters: LogStatsFilters): Promise<LogStats> {
    return queryLogStats(this.pool, tenantId, filters);
  }

  async operations(tenantId: string, filters: LogFilters): Promise<OperationCount[]> {
    return queryOperations(this.pool, tenantId, filters);
  }

  async operationValues(tenantId: string, filters: LogFilters): Promise<OperationValue[]> {
    return queryOperationValues(this.pool, tenantId, filters);
  }

  async roles(tenantId: string, filters: LogFilters): Promise<{ role: string; count: number }[]> {
    return queryRoles(this.pool, tenantId, filters);
  }

  async roleValues(tenantId: string, filters: LogFilters): Promise<RoleValue[]> {
    return queryRoleValues(this.pool, tenantId, filters);
  }

  async actors(tenantId: string, filters: LogFilters): Promise<ActorInfo[]> {
    return queryActors(this.pool, tenantId, filters);
  }

  async actorKindValues(tenantId: string, filters: LogFilters): Promise<ActorKindValue[]> {
    return queryActorKindValues(this.pool, tenantId, filters);
  }

  async workflowValues(
    tenantId: string,
    filters: Pick<LogFilters, 'workspaceId'>,
  ): Promise<WorkflowValue[]> {
    return queryWorkflowValues(this.pool, tenantId, filters);
  }

  async *export(tenantId: string, filters: LogFilters): AsyncGenerator<LogRow> {
    yield* exportLogs(this.pool, tenantId, filters);
  }

  private get writeContext() {
    return {
      pool: this.pool,
      levelFilter: this.levelFilter,
      partitions: this.partitions,
    };
  }
}
