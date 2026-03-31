import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { LogService } from '../../logging/log-service.js';
import { applyRuleOutcome } from './rule-outcome.js';
import { hasNewerSpecialistHandoffSinceActivation } from './query-helpers.js';
import {
  clearAssessmentExpectationState,
  persistOrchestratorFinishStateState,
} from './state-operations.js';
import type { OrchestratorFinishStateUpdate } from './types.js';

export type {
  WorkItemCompletionOutcome,
} from './types.js';

export class WorkItemContinuityService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly logService?: LogService,
  ) {}

  async recordTaskCompleted(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return applyRuleOutcome(this.logService, tenantId, task, 'task_completed', db);
  }

  async recordAssessmentRequestedChanges(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return applyRuleOutcome(this.logService, tenantId, task, 'assessment_requested_changes', db);
  }

  async hasNewerSpecialistHandoffSinceActivation(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    parentWorkItemId: string | null,
    activationId: string | null,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return hasNewerSpecialistHandoffSinceActivation(
      tenantId,
      workflowId,
      workItemId,
      parentWorkItemId,
      activationId,
      db,
    );
  }

  async clearAssessmentExpectation(
    tenantId: string,
    task: Record<string, unknown>,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return clearAssessmentExpectationState(this.logService, tenantId, task, db);
  }

  async persistOrchestratorFinishState(
    tenantId: string,
    task: Record<string, unknown>,
    update: OrchestratorFinishStateUpdate,
    db: DatabaseClient | DatabasePool = this.pool,
  ) {
    return persistOrchestratorFinishStateState(this.logService, tenantId, task, update, db);
  }
}
