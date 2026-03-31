import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import type {
  AdvanceStageInput,
  CompleteWorkflowInput,
  CompleteWorkflowWorkItemInput,
  Dependencies,
  ResolveWorkflowWorkItemEscalationInput,
  StageGateDecisionInput,
  StageGateRequestInput,
  UpdateWorkflowWorkItemInput,
} from './playbook-workflow-control-private-impl.js';
import {
  actOnGateInTransactionImpl,
  actOnStageGateInTransactionImpl,
  advanceStageInTransactionImpl,
  applyGateDecisionImpl,
  assertNoPendingBlockingContinuationImpl,
  assertStageHasNoBlockingAssessmentResolutionImpl,
  assertStageHasNoPendingBlockingContinuationImpl,
  assertValidParentChangeImpl,
  assertWorkItemHasNoActiveTasksImpl,
  assertWorkItemHasNoBlockingAssessmentResolutionImpl,
  assertWorkflowHasNoActiveNonOrchestratorTasksImpl,
  completeOpenCheckpointWorkItemsImpl,
  completeWorkItemInTransactionImpl,
  completeWorkflowInTransactionImpl,
  hasNewGateRelatedHandoffSinceGateDecisionImpl,
  hasSatisfiedPendingHandoffImpl,
  loadAwaitingGateByIdImpl,
  loadAwaitingGateImpl,
  loadGateByIdImpl,
  loadGateRequestChangeTargetsImpl,
  loadLatestGateForStageImpl,
  loadStageImpl,
  loadWorkItemImpl,
  loadWorkflowCompletionCalloutsImpl,
  loadWorkflowImpl,
  reactivateApprovedStageIfAwaitingGateImpl,
  requestStageGateApprovalInTransactionImpl,
  resolveWorkItemEscalationInTransactionImpl,
  updateWorkItemInTransactionImpl,
} from './playbook-workflow-control-private-impl.js';

export type {
  UpdateWorkflowWorkItemInput,
  CompleteWorkflowWorkItemInput,
  ResolveWorkflowWorkItemEscalationInput,
  StageGateRequestInput,
  StageGateDecisionInput,
  AdvanceStageInput,
  CompleteWorkflowInput,
} from './playbook-workflow-control-private-impl.js';

export class PlaybookWorkflowControlService {
  constructor(private readonly deps: Dependencies) {}

  async updateWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: UpdateWorkflowWorkItemInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.updateWorkItemInTransaction(identity, workflowId, workItemId, input, client);
    }

    const db = await this.deps.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await this.updateWorkItemInTransaction(identity, workflowId, workItemId, input, db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async completeWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: CompleteWorkflowWorkItemInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.completeWorkItemInTransaction(identity, workflowId, workItemId, input, client);
    }

    const db = await this.deps.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await this.completeWorkItemInTransaction(identity, workflowId, workItemId, input, db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async resolveWorkItemEscalation(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: ResolveWorkflowWorkItemEscalationInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.resolveWorkItemEscalationInTransaction(identity, workflowId, workItemId, input, client);
    }

    return this.runInTransaction((db) =>
      this.resolveWorkItemEscalationInTransaction(identity, workflowId, workItemId, input, db),
    );
  }

  async requestStageGateApproval(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: StageGateRequestInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.requestStageGateApprovalInTransaction(
        identity,
        workflowId,
        stageName,
        input,
        client,
      );
    }

    return this.runInTransaction((db) =>
      this.requestStageGateApprovalInTransaction(identity, workflowId, stageName, input, db),
    );
  }

  async actOnStageGate(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: StageGateDecisionInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.actOnStageGateInTransaction(identity, workflowId, stageName, input, client);
    }

    return this.runInTransaction((db) =>
      this.actOnStageGateInTransaction(identity, workflowId, stageName, input, db),
    );
  }

  async actOnGate(
    identity: ApiKeyIdentity,
    gateId: string,
    input: StageGateDecisionInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.actOnGateInTransaction(identity, gateId, input, client);
    }

    return this.runInTransaction((db) => this.actOnGateInTransaction(identity, gateId, input, db));
  }

  async advanceStage(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: AdvanceStageInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.advanceStageInTransaction(identity, workflowId, stageName, input, client);
    }

    return this.runInTransaction((db) =>
      this.advanceStageInTransaction(identity, workflowId, stageName, input, db),
    );
  }

  async completeWorkflow(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CompleteWorkflowInput,
    client?: DatabaseClient,
  ) {
    if (client) {
      return this.completeWorkflowInTransaction(identity, workflowId, input, client);
    }

    return this.runInTransaction((db) =>
      this.completeWorkflowInTransaction(identity, workflowId, input, db),
    );
  }

  private async runInTransaction<T>(run: (db: DatabaseClient) => Promise<T>): Promise<T> {
    const db = await this.deps.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await run(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  private async requestStageGateApprovalInTransaction(...args: any[]) {
    return requestStageGateApprovalInTransactionImpl.apply(this, args);
  }

  private async actOnStageGateInTransaction(...args: any[]) {
    return actOnStageGateInTransactionImpl.apply(this, args);
  }

  private async actOnGateInTransaction(...args: any[]) {
    return actOnGateInTransactionImpl.apply(this, args);
  }

  private async advanceStageInTransaction(...args: any[]) {
    return advanceStageInTransactionImpl.apply(this, args);
  }

  private async completeOpenCheckpointWorkItems(...args: any[]) {
    return completeOpenCheckpointWorkItemsImpl.apply(this, args);
  }

  private async assertStageHasNoBlockingAssessmentResolution(...args: any[]) {
    return assertStageHasNoBlockingAssessmentResolutionImpl.apply(this, args);
  }

  private async assertNoPendingBlockingContinuation(...args: any[]) {
    return assertNoPendingBlockingContinuationImpl.apply(this, args);
  }

  private async assertWorkItemHasNoActiveTasks(...args: any[]) {
    return assertWorkItemHasNoActiveTasksImpl.apply(this, args);
  }

  private async assertStageHasNoPendingBlockingContinuation(...args: any[]) {
    return assertStageHasNoPendingBlockingContinuationImpl.apply(this, args);
  }

  private async assertWorkflowHasNoActiveNonOrchestratorTasks(...args: any[]) {
    return assertWorkflowHasNoActiveNonOrchestratorTasksImpl.apply(this, args);
  }

  private async completeWorkflowInTransaction(...args: any[]) {
    return completeWorkflowInTransactionImpl.apply(this, args);
  }

  private async loadWorkflow(...args: any[]) {
    return loadWorkflowImpl.apply(this, args);
  }

  private async loadWorkItem(...args: any[]) {
    return loadWorkItemImpl.apply(this, args);
  }

  private async loadWorkflowCompletionCallouts(...args: any[]) {
    return loadWorkflowCompletionCalloutsImpl.apply(this, args);
  }

  private async updateWorkItemInTransaction(...args: any[]) {
    return updateWorkItemInTransactionImpl.apply(this, args);
  }

  private async completeWorkItemInTransaction(...args: any[]) {
    return completeWorkItemInTransactionImpl.apply(this, args);
  }

  private async resolveWorkItemEscalationInTransaction(...args: any[]) {
    return resolveWorkItemEscalationInTransactionImpl.apply(this, args);
  }

  private async assertWorkItemHasNoBlockingAssessmentResolution(...args: any[]) {
    return assertWorkItemHasNoBlockingAssessmentResolutionImpl.apply(this, args);
  }

  private async hasSatisfiedPendingHandoff(...args: any[]) {
    return hasSatisfiedPendingHandoffImpl.apply(this, args);
  }

  private async assertValidParentChange(...args: any[]) {
    return assertValidParentChangeImpl.apply(this, args);
  }

  private async loadStage(...args: any[]) {
    return loadStageImpl.apply(this, args);
  }

  private async loadAwaitingGate(...args: any[]) {
    return loadAwaitingGateImpl.apply(this, args);
  }

  private async loadAwaitingGateById(...args: any[]) {
    return loadAwaitingGateByIdImpl.apply(this, args);
  }

  private async loadGateById(...args: any[]) {
    return loadGateByIdImpl.apply(this, args);
  }

  private async loadLatestGateForStage(...args: any[]) {
    return loadLatestGateForStageImpl.apply(this, args);
  }

  private async loadGateRequestChangeTargets(...args: any[]) {
    return loadGateRequestChangeTargetsImpl.apply(this, args);
  }

  private async reactivateApprovedStageIfAwaitingGate(...args: any[]) {
    return reactivateApprovedStageIfAwaitingGateImpl.apply(this, args);
  }

  private async hasNewGateRelatedHandoffSinceGateDecision(...args: any[]) {
    return hasNewGateRelatedHandoffSinceGateDecisionImpl.apply(this, args);
  }

  private async applyGateDecision(...args: any[]) {
    return applyGateDecisionImpl.apply(this, args);
  }

}
