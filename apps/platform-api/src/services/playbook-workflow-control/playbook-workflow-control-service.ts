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

  private async requestStageGateApprovalInTransaction(
    ...args: Parameters<typeof requestStageGateApprovalInTransactionImpl>
  ) {
    return requestStageGateApprovalInTransactionImpl.apply(this, args);
  }

  private async actOnStageGateInTransaction(...args: Parameters<typeof actOnStageGateInTransactionImpl>) {
    return actOnStageGateInTransactionImpl.apply(this, args);
  }

  private async actOnGateInTransaction(...args: Parameters<typeof actOnGateInTransactionImpl>) {
    return actOnGateInTransactionImpl.apply(this, args);
  }

  private async advanceStageInTransaction(...args: Parameters<typeof advanceStageInTransactionImpl>) {
    return advanceStageInTransactionImpl.apply(this, args);
  }

  private async completeOpenCheckpointWorkItems(
    ...args: Parameters<typeof completeOpenCheckpointWorkItemsImpl>
  ) {
    return completeOpenCheckpointWorkItemsImpl.apply(this, args);
  }

  private async assertStageHasNoBlockingAssessmentResolution(
    ...args: Parameters<typeof assertStageHasNoBlockingAssessmentResolutionImpl>
  ) {
    return assertStageHasNoBlockingAssessmentResolutionImpl.apply(this, args);
  }

  private async assertNoPendingBlockingContinuation(
    ...args: Parameters<typeof assertNoPendingBlockingContinuationImpl>
  ) {
    return assertNoPendingBlockingContinuationImpl.apply(this, args);
  }

  private async assertWorkItemHasNoActiveTasks(
    ...args: Parameters<typeof assertWorkItemHasNoActiveTasksImpl>
  ) {
    return assertWorkItemHasNoActiveTasksImpl.apply(this, args);
  }

  private async assertStageHasNoPendingBlockingContinuation(
    ...args: Parameters<typeof assertStageHasNoPendingBlockingContinuationImpl>
  ) {
    return assertStageHasNoPendingBlockingContinuationImpl.apply(this, args);
  }

  private async assertWorkflowHasNoActiveNonOrchestratorTasks(
    ...args: Parameters<typeof assertWorkflowHasNoActiveNonOrchestratorTasksImpl>
  ) {
    return assertWorkflowHasNoActiveNonOrchestratorTasksImpl.apply(this, args);
  }

  private async completeWorkflowInTransaction(...args: Parameters<typeof completeWorkflowInTransactionImpl>) {
    return completeWorkflowInTransactionImpl.apply(this, args);
  }

  private async loadWorkflow(...args: Parameters<typeof loadWorkflowImpl>) {
    return loadWorkflowImpl.apply(this, args);
  }

  private async loadWorkItem(...args: Parameters<typeof loadWorkItemImpl>) {
    return loadWorkItemImpl.apply(this, args);
  }

  private async loadWorkflowCompletionCallouts(
    ...args: Parameters<typeof loadWorkflowCompletionCalloutsImpl>
  ) {
    return loadWorkflowCompletionCalloutsImpl.apply(this, args);
  }

  private async updateWorkItemInTransaction(...args: Parameters<typeof updateWorkItemInTransactionImpl>) {
    return updateWorkItemInTransactionImpl.apply(this, args);
  }

  private async completeWorkItemInTransaction(
    ...args: Parameters<typeof completeWorkItemInTransactionImpl>
  ) {
    return completeWorkItemInTransactionImpl.apply(this, args);
  }

  private async resolveWorkItemEscalationInTransaction(
    ...args: Parameters<typeof resolveWorkItemEscalationInTransactionImpl>
  ) {
    return resolveWorkItemEscalationInTransactionImpl.apply(this, args);
  }

  private async assertWorkItemHasNoBlockingAssessmentResolution(
    ...args: Parameters<typeof assertWorkItemHasNoBlockingAssessmentResolutionImpl>
  ) {
    return assertWorkItemHasNoBlockingAssessmentResolutionImpl.apply(this, args);
  }

  private async hasSatisfiedPendingHandoff(...args: Parameters<typeof hasSatisfiedPendingHandoffImpl>) {
    return hasSatisfiedPendingHandoffImpl.apply(this, args);
  }

  private async assertValidParentChange(...args: Parameters<typeof assertValidParentChangeImpl>) {
    return assertValidParentChangeImpl.apply(this, args);
  }

  private async loadStage(...args: Parameters<typeof loadStageImpl>) {
    return loadStageImpl.apply(this, args);
  }

  private async loadAwaitingGate(...args: Parameters<typeof loadAwaitingGateImpl>) {
    return loadAwaitingGateImpl.apply(this, args);
  }

  private async loadAwaitingGateById(...args: Parameters<typeof loadAwaitingGateByIdImpl>) {
    return loadAwaitingGateByIdImpl.apply(this, args);
  }

  private async loadGateById(...args: Parameters<typeof loadGateByIdImpl>) {
    return loadGateByIdImpl.apply(this, args);
  }

  private async loadLatestGateForStage(...args: Parameters<typeof loadLatestGateForStageImpl>) {
    return loadLatestGateForStageImpl.apply(this, args);
  }

  private async loadGateRequestChangeTargets(
    ...args: Parameters<typeof loadGateRequestChangeTargetsImpl>
  ) {
    return loadGateRequestChangeTargetsImpl.apply(this, args);
  }

  private async reactivateApprovedStageIfAwaitingGate(
    ...args: Parameters<typeof reactivateApprovedStageIfAwaitingGateImpl>
  ) {
    return reactivateApprovedStageIfAwaitingGateImpl.apply(this, args);
  }

  private async hasNewGateRelatedHandoffSinceGateDecision(
    ...args: Parameters<typeof hasNewGateRelatedHandoffSinceGateDecisionImpl>
  ) {
    return hasNewGateRelatedHandoffSinceGateDecisionImpl.apply(this, args);
  }

  private async applyGateDecision(...args: Parameters<typeof applyGateDecisionImpl>) {
    return applyGateDecisionImpl.apply(this, args);
  }

}
