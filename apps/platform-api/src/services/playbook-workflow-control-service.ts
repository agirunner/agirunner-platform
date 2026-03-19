import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  hasBoardColumn,
  hasStage,
  parsePlaybookDefinition,
  type PlaybookDefinition,
} from '../orchestration/playbook-model.js';
import { EventService } from './event-service.js';
import { areJsonValuesEquivalent } from './json-equivalence.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from './workflow-activation-service.js';
import { loadWorkflowStageProjection } from './workflow-stage-projection.js';
import { reconcilePlannedWorkflowStages } from './workflow-stage-reconciliation.js';
import { toGateResponse, type WorkflowStageGateRecord } from './workflow-stage-gate-service.js';
import { WorkflowStateService } from './workflow-state-service.js';

interface WorkflowContextRow {
  id: string;
  workspace_id: string | null;
  playbook_id: string;
  lifecycle: string | null;
  active_stage_name: string | null;
  state: string;
  orchestration_state?: Record<string, unknown> | null;
  definition: unknown;
}

interface WorkflowWorkItemRow {
  id: string;
  parent_work_item_id: string | null;
  stage_name: string;
  title: string;
  goal: string | null;
  acceptance_criteria: string | null;
  column_id: string;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  rework_count: number;
  priority: 'critical' | 'high' | 'normal' | 'low';
  notes: string | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  updated_at: Date;
}

type WorkflowWorkItemResponse = Omit<WorkflowWorkItemRow, 'completed_at' | 'updated_at'> & {
  completed_at: string | null;
  updated_at: string;
};

interface WorkflowStageRow {
  id: string;
  name: string;
  position: number;
  goal: string;
  guidance: string | null;
  human_gate: boolean;
  status: string;
  gate_status: string;
  iteration_count: number;
  summary: string | null;
  metadata: Record<string, unknown>;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
}

interface WorkflowStageGateRow extends WorkflowStageGateRecord {
  id: string;
  workflow_id: string;
  stage_id: string;
  stage_name: string;
  status: string;
  request_summary: string | null;
  recommendation: string | null;
  concerns: unknown;
  key_artifacts: unknown;
  requested_at: Date;
  updated_at: Date;
  decision_feedback: string | null;
  decided_at: Date | null;
}

export interface UpdateWorkflowWorkItemInput {
  parent_work_item_id?: string | null;
  title?: string;
  goal?: string;
  acceptance_criteria?: string;
  stage_name?: string;
  column_id?: string;
  owner_role?: string | null;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StageGateRequestInput {
  summary: string;
  recommendation?: string;
  key_artifacts?: Array<{ id?: string; task_id?: string; label?: string; path?: string }>;
  concerns?: string[];
}

export interface StageGateDecisionInput {
  action: 'approve' | 'reject' | 'request_changes';
  feedback?: string;
}

export interface AdvanceStageInput {
  to_stage_name?: string;
  summary?: string;
}

export interface CompleteWorkflowInput {
  summary: string;
  final_artifacts?: string[];
}

interface NormalizedWorkItemUpdate {
  parent_work_item_id: string | null;
  title: string;
  goal: string | null;
  acceptance_criteria: string | null;
  stage_name: string;
  column_id: string;
  owner_role: string | null;
  priority: 'critical' | 'high' | 'normal' | 'low';
  notes: string | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
}

interface Dependencies {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  activationService: WorkflowActivationService;
  activationDispatchService: WorkflowActivationDispatchService;
}

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

  private async requestStageGateApprovalInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: StageGateRequestInput,
    db: DatabaseClient,
  ) {
    const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
    if (workflow.lifecycle !== 'planned') {
      throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
    }

    const stage = await this.loadStage(identity.tenantId, workflowId, stageName, db);
    if (!stage.human_gate) {
      throw new ValidationError(`Stage '${stageName}' does not require a human gate`);
    }
    if (stage.gate_status === 'approved') {
      return toStageResponse(stage);
    }

    const existingGate = await this.loadAwaitingGate(identity.tenantId, workflowId, stage.id, db);
    if (existingGate) {
      return toStageResponse(stage);
    }

    const latestGate = await this.loadLatestGateForStage(identity.tenantId, workflowId, stage.id, db);
    if (
      latestGate?.status === 'changes_requested'
      && latestGate.decided_at
      && !(await this.hasNewStageHandoffSinceGateDecision(
        identity.tenantId,
        workflowId,
        stage.name,
        latestGate.decided_at,
        db,
      ))
    ) {
      throw new ConflictError(
        `Stage '${stageName}' was sent back with changes requested. Complete corrective work and submit a new stage handoff before requesting approval again.`,
      );
    }

    const recommendation = nullableText(input.recommendation);
    const keyArtifacts = normalizeArtifactList(input.key_artifacts);
    const concerns = normalizeConcernList(input.concerns);
    const gateResult = await db.query<WorkflowStageGateRow>(
      `INSERT INTO workflow_stage_gates (
          tenant_id, workflow_id, stage_id, stage_name, request_summary,
          recommendation, concerns, key_artifacts, status,
          requested_by_type, requested_by_id, requested_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'awaiting_approval', $9, $10, now())
      RETURNING id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
                concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
                updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at`,
      [
        identity.tenantId,
        workflowId,
        stage.id,
        stageName,
        input.summary.trim(),
        recommendation,
        JSON.stringify(concerns),
        JSON.stringify(keyArtifacts),
        identity.scope,
        identity.keyPrefix,
      ],
    );
    const gate = gateResult.rows[0];
    const result = await db.query<WorkflowStageRow>(
      `UPDATE workflow_stages
          SET status = 'awaiting_gate',
              gate_status = 'awaiting_approval',
              summary = $4,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND name = $3
      RETURNING id, name, position, goal, guidance, human_gate, status, gate_status,
                iteration_count, summary, metadata, started_at, completed_at, updated_at`,
      [identity.tenantId, workflowId, stageName, input.summary.trim()],
    );

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'stage.gate_requested',
        entityType: 'gate',
        entityId: gate.id,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          workflow_id: workflowId,
          stage_name: stageName,
          gate_id: gate.id,
          request_summary: input.summary.trim(),
          recommendation,
        },
      },
      db,
    );
    await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });
    return toStageResponse(result.rows[0]);
  }

  private async actOnStageGateInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: StageGateDecisionInput,
    db: DatabaseClient,
  ) {
    const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
    if (workflow.lifecycle !== 'planned') {
      throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
    }

    const stage = await this.loadStage(identity.tenantId, workflowId, stageName, db);
    if (!stage.human_gate) {
      throw new ValidationError(`Stage '${stageName}' does not require a human gate`);
    }

    const gate = await this.loadAwaitingGate(identity.tenantId, workflowId, stage.id, db);
    if (!gate) {
      const latestGate = await this.loadLatestGateForStage(identity.tenantId, workflowId, stage.id, db);
      if (isIdempotentGateDecision(latestGate, input)) {
        return toStageDecisionResponse(stage);
      }
      if (isFollowOnGateDecisionAllowed(latestGate, input)) {
        const outcome = await this.applyGateDecision(identity, workflowId, stage, latestGate, input, db);
        return toStageDecisionResponse(outcome.stage, outcome.activation);
      }
      throw new ConflictError('No pending gate approval exists for this stage');
    }
    const outcome = await this.applyGateDecision(identity, workflowId, stage, gate, input, db);
    return toStageDecisionResponse(outcome.stage, outcome.activation);
  }

  private async actOnGateInTransaction(
    identity: ApiKeyIdentity,
    gateId: string,
    input: StageGateDecisionInput,
    db: DatabaseClient,
  ) {
    const gate = await this.loadAwaitingGateById(identity.tenantId, gateId, db);
    if (!gate) {
      const existingGate = await this.loadGateById(identity.tenantId, gateId, db);
      if (isIdempotentGateDecision(existingGate, input)) {
        return toGateResponse(existingGate);
      }
      if (isFollowOnGateDecisionAllowed(existingGate, input)) {
        const workflow = await this.loadWorkflow(identity.tenantId, existingGate.workflow_id, db);
        if (workflow.lifecycle !== 'planned') {
          throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
        }
        const stage = await this.loadStage(identity.tenantId, workflow.id, existingGate.stage_name, db);
        const outcome = await this.applyGateDecision(identity, workflow.id, stage, existingGate, input, db);
        return toGateResponse({
          ...outcome.gate,
          resume_activation_id: outcome.activation.activation_id ?? outcome.activation.id,
          resume_activation_state: outcome.activation.state,
          resume_activation_event_type: outcome.activation.event_type,
          resume_activation_reason: outcome.activation.reason,
          resume_activation_queued_at: parseOptionalTimestamp(outcome.activation.queued_at),
          resume_activation_started_at: parseOptionalTimestamp(outcome.activation.started_at),
          resume_activation_completed_at: parseOptionalTimestamp(outcome.activation.completed_at),
          resume_activation_summary: outcome.activation.summary,
          resume_activation_error: outcome.activation.error,
        });
      }
      throw new ConflictError('No pending gate approval exists for this gate');
    }
    const workflow = await this.loadWorkflow(identity.tenantId, gate.workflow_id, db);
    if (workflow.lifecycle !== 'planned') {
      throw new ConflictError('Stage gate approvals are only supported for planned playbook workflows');
    }

    const stage = await this.loadStage(identity.tenantId, workflow.id, gate.stage_name, db);
    const outcome = await this.applyGateDecision(identity, workflow.id, stage, gate, input, db);
    return toGateResponse({
      ...outcome.gate,
      resume_activation_id: outcome.activation.activation_id ?? outcome.activation.id,
      resume_activation_state: outcome.activation.state,
      resume_activation_event_type: outcome.activation.event_type,
      resume_activation_reason: outcome.activation.reason,
      resume_activation_queued_at: parseOptionalTimestamp(outcome.activation.queued_at),
      resume_activation_started_at: parseOptionalTimestamp(outcome.activation.started_at),
      resume_activation_completed_at: parseOptionalTimestamp(outcome.activation.completed_at),
      resume_activation_summary: outcome.activation.summary,
      resume_activation_error: outcome.activation.error,
    });
  }

  private async advanceStageInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    stageName: string,
    input: AdvanceStageInput,
    db: DatabaseClient,
  ) {
    const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
    if (workflow.lifecycle !== 'planned') {
      throw new ConflictError('Stage advancement is only supported for planned playbook workflows');
    }

    const definition = parsePlaybookDefinition(workflow.definition);
    const sourceStage = await this.loadStage(identity.tenantId, workflowId, stageName, db);
    const expectedNextStageName = nextStageNameFor(definition, sourceStage.name);
    if (!expectedNextStageName) {
      throw new ValidationError('No next stage is available; use complete_workflow for the final stage');
    }
    const nextStageName = input.to_stage_name ?? expectedNextStageName;
    if (nextStageName !== expectedNextStageName) {
      throw new ValidationError(
        `Stage '${stageName}' may only advance to the immediate next planned stage ` +
          `'${expectedNextStageName}', not '${nextStageName}'.`,
      );
    }
    if (workflow.active_stage_name !== sourceStage.name) {
      if (isIdempotentStageAdvance(workflow.active_stage_name, sourceStage, nextStageName)) {
        return {
          completed_stage: stageName,
          next_stage: nextStageName,
        };
      }
      throw new ValidationError(`Stage '${stageName}' is not the current workflow stage`);
    }
    if (sourceStage.human_gate && sourceStage.gate_status !== 'approved') {
      throw new ValidationError(`Stage '${stageName}' requires human approval before it can advance`);
    }

    const nextStage = await this.loadStage(identity.tenantId, workflowId, nextStageName, db);
    await this.completeOpenCheckpointWorkItems(
      identity.tenantId,
      workflowId,
      sourceStage.name,
      terminalColumnIdFor(definition),
      db,
    );
    await db.query(
      `UPDATE workflow_stages
          SET status = 'completed',
              completed_at = now(),
              summary = COALESCE($4, summary),
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND name = $3`,
      [identity.tenantId, workflowId, stageName, nullableText(input.summary)],
    );
    await db.query(
      `UPDATE workflow_stages
          SET status = 'active',
              started_at = COALESCE(started_at, now()),
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND name = $3`,
      [identity.tenantId, workflowId, nextStage.name],
    );

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'stage.completed',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { stage_name: stageName, summary: nullableText(input.summary) },
      },
      db,
    );
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'stage.started',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { stage_name: nextStage.name },
      },
      db,
    );
    await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });

    const activation = await this.deps.activationService.enqueueForWorkflow(
      {
        tenantId: identity.tenantId,
        workflowId,
        reason: 'stage.started',
        eventType: 'stage.started',
        payload: {
          stage_name: nextStage.name,
          previous_stage_name: stageName,
        },
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      },
      db,
    );
    await this.deps.activationDispatchService.dispatchActivation(
      identity.tenantId,
      String(activation.id),
      db,
    );

    return {
      completed_stage: stageName,
      next_stage: nextStage.name,
    };
  }

  private async completeOpenCheckpointWorkItems(
    tenantId: string,
    workflowId: string,
    checkpointName: string,
    terminalColumnId: string | null,
    db: DatabaseClient,
  ) {
    if (terminalColumnId) {
      await db.query(
        `UPDATE workflow_work_items
            SET column_id = $4,
                completed_at = COALESCE(completed_at, now()),
                next_expected_actor = NULL,
                next_expected_action = NULL,
                updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
            AND stage_name = $3
            AND completed_at IS NULL`,
        [tenantId, workflowId, checkpointName, terminalColumnId],
      );
      return;
    }

    await db.query(
      `UPDATE workflow_work_items
          SET completed_at = COALESCE(completed_at, now()),
              next_expected_actor = NULL,
              next_expected_action = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND stage_name = $3
          AND completed_at IS NULL`,
      [tenantId, workflowId, checkpointName],
    );
  }

  private async completeWorkflowInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CompleteWorkflowInput,
    db: DatabaseClient,
  ) {
    let workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
    if (workflow.lifecycle !== 'planned') {
      throw new ConflictError('Only planned playbook workflows can be completed by the orchestrator');
    }
    const definition = parsePlaybookDefinition(workflow.definition);
    if (workflow.state === 'completed') {
      return {
        workflow_id: workflowId,
        state: 'completed',
        summary: readCompletionSummary(workflow) ?? input.summary.trim(),
        final_artifacts: readCompletionArtifacts(workflow),
      };
    }

    await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);
    workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);

    const finalArtifacts = normalizeStringArray(input.final_artifacts);
    if (workflow.active_stage_name) {
      const stage = await this.loadStage(identity.tenantId, workflowId, workflow.active_stage_name, db);
      if (stage.human_gate && stage.gate_status !== 'approved') {
        throw new ValidationError(`Stage '${stage.name}' requires human approval before workflow completion`);
      }
      await this.completeOpenCheckpointWorkItems(
        identity.tenantId,
        workflowId,
        stage.name,
        terminalColumnIdFor(definition),
        db,
      );
      if (stage.status !== 'completed') {
        await db.query(
          `UPDATE workflow_stages
              SET status = 'completed',
                  completed_at = COALESCE(completed_at, now()),
                  summary = COALESCE($4, summary),
                  updated_at = now()
            WHERE tenant_id = $1
              AND workflow_id = $2
              AND name = $3`,
          [identity.tenantId, workflowId, stage.name, input.summary.trim()],
        );
        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'stage.completed',
            entityType: 'workflow',
            entityId: workflowId,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: { stage_name: stage.name, summary: input.summary.trim() },
          },
          db,
        );
      }
    }

    const incompleteStages = await db.query<{ name: string }>(
      `SELECT name
         FROM workflow_stages
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND status <> 'completed'
        LIMIT 1`,
      [identity.tenantId, workflowId],
    );
    if (incompleteStages.rowCount) {
      throw new ValidationError(`Workflow still has incomplete stage '${incompleteStages.rows[0].name}'`);
    }

    await db.query(
      `UPDATE workflows
          SET orchestration_state = jsonb_set(
                jsonb_set(
                  COALESCE(orchestration_state, '{}'::jsonb),
                  '{completion_summary}',
                  to_jsonb($3::text),
                  true
                ),
                '{final_artifacts}',
                $4::jsonb,
                true
              ),
              updated_at = now()
        WHERE tenant_id = $1
          AND id = $2`,
      [identity.tenantId, workflowId, input.summary.trim(), JSON.stringify(finalArtifacts)],
    );
    const state = await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });
    if (state !== 'completed') {
      throw new ConflictError('Workflow could not be completed');
    }
    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: 'workflow.completed',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: { summary: input.summary.trim(), final_artifacts: finalArtifacts },
      },
      db,
    );
    return {
      workflow_id: workflowId,
      state,
      summary: input.summary.trim(),
      final_artifacts: finalArtifacts,
    };
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

  private async loadWorkflow(tenantId: string, workflowId: string, db: DatabaseClient | DatabasePool) {
    const result = await db.query<WorkflowContextRow>(
      `SELECT w.id,
              w.workspace_id,
              w.playbook_id,
              w.lifecycle,
              w.state,
              p.definition
              , w.orchestration_state
         FROM workflows w
         JOIN playbooks p
           ON p.tenant_id = w.tenant_id
          AND p.id = w.playbook_id
        WHERE w.tenant_id = $1
          AND w.id = $2
        FOR UPDATE OF w`,
      [tenantId, workflowId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Playbook workflow not found');
    }
    const workflow = result.rows[0] as WorkflowContextRow;
    if (Object.hasOwn(workflow, 'active_stage_name')) {
      return {
        ...workflow,
        active_stage_name: typeof workflow.active_stage_name === 'string' ? workflow.active_stage_name : null,
      } satisfies WorkflowContextRow;
    }
    const projection = await loadWorkflowStageProjection(db, tenantId, workflowId, {
      lifecycle: workflow.lifecycle === 'ongoing' ? 'ongoing' : 'planned',
      definition: workflow.definition,
    });
    return {
      ...workflow,
      active_stage_name: projection.currentStage,
    } satisfies WorkflowContextRow;
  }

  private async loadWorkItem(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowWorkItemRow>(
      `SELECT id,
              parent_work_item_id,
              stage_name,
              title,
              goal,
              acceptance_criteria,
              column_id,
              owner_role,
              next_expected_actor,
              next_expected_action,
              rework_count,
              priority,
              notes,
              completed_at,
              metadata,
              updated_at
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        FOR UPDATE`,
      [tenantId, workflowId, workItemId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow work item not found');
    }
    return result.rows[0];
  }

  private async updateWorkItemInTransaction(
    identity: ApiKeyIdentity,
    workflowId: string,
    workItemId: string,
    input: UpdateWorkflowWorkItemInput,
    db: DatabaseClient,
  ) {
    const workflow = await this.loadWorkflow(identity.tenantId, workflowId, db);
    const definition = parsePlaybookDefinition(workflow.definition);
    const workItem = await this.loadWorkItem(identity.tenantId, workflowId, workItemId, db);

    const nextStageName = input.stage_name ?? workItem.stage_name;
    const nextColumnId = input.column_id ?? workItem.column_id;
    const nextParentWorkItemId =
      input.parent_work_item_id === undefined ? workItem.parent_work_item_id : input.parent_work_item_id;
    if (!hasStage(definition, nextStageName)) {
      throw new ValidationError(`Unknown stage '${nextStageName}' for this workflow`);
    }
    if (!hasBoardColumn(definition, nextColumnId)) {
      throw new ValidationError(`Unknown board column '${nextColumnId}' for this workflow`);
    }
    await this.assertValidParentChange(identity.tenantId, workflowId, workItemId, nextParentWorkItemId, db);

    const terminalColumns = new Set(
      definition.board.columns.filter((column) => column.is_terminal).map((column) => column.id),
    );
    const normalizedUpdate = normalizeWorkItemUpdate(workItem, input, {
      parentWorkItemId: nextParentWorkItemId,
      stageName: nextStageName,
      columnId: nextColumnId,
      terminalColumns,
    });
    if (sameNormalizedWorkItem(workItem, normalizedUpdate)) {
      return toWorkItemResponse(workItem);
    }

    const result = await db.query<WorkflowWorkItemRow>(
      `UPDATE workflow_work_items
          SET parent_work_item_id = $4,
              title = $5,
              goal = $6,
              acceptance_criteria = $7,
              stage_name = $8,
              column_id = $9,
              owner_role = $10,
              priority = $11,
              notes = $12,
              completed_at = $13,
              metadata = $14::jsonb,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
      RETURNING id,
                parent_work_item_id,
                stage_name,
                title,
                goal,
                acceptance_criteria,
                column_id,
                owner_role,
                next_expected_actor,
                next_expected_action,
                rework_count,
                priority,
                notes,
                completed_at,
                metadata,
                updated_at`,
      [
        identity.tenantId,
        workflowId,
        workItemId,
        normalizedUpdate.parent_work_item_id,
        normalizedUpdate.title,
        normalizedUpdate.goal,
        normalizedUpdate.acceptance_criteria,
        normalizedUpdate.stage_name,
        normalizedUpdate.column_id,
        normalizedUpdate.owner_role,
        normalizedUpdate.priority,
        normalizedUpdate.notes,
        normalizedUpdate.completed_at,
        normalizedUpdate.metadata,
      ],
    );

    const updatedWorkItem = result.rows[0];
    if (workflow.lifecycle === 'planned') {
      await reconcilePlannedWorkflowStages(db, identity.tenantId, workflowId);
    }
    await emitWorkItemUpdateEvents(this.deps, identity, workflowId, workItem, updatedWorkItem, db);
    const activation = await this.deps.activationService.enqueueForWorkflow(
      {
        tenantId: identity.tenantId,
        workflowId,
        reason: 'work_item.updated',
        eventType: 'work_item.updated',
        payload: buildWorkItemUpdatePayload(workItem, updatedWorkItem),
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      },
      db,
    );
    await this.deps.activationDispatchService.dispatchActivation(
      identity.tenantId,
      String(activation.id),
      db,
    );
    await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, db, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });
    return toWorkItemResponse(updatedWorkItem);
  }

  private async assertValidParentChange(
    tenantId: string,
    workflowId: string,
    workItemId: string,
    parentWorkItemId: string | null,
    db: DatabaseClient,
  ) {
    if (!parentWorkItemId) {
      return;
    }
    if (parentWorkItemId === workItemId) {
      throw new ValidationError('A work item cannot be its own parent');
    }

    const parentResult = await db.query<{ id: string }>(
      `SELECT id
         FROM workflow_work_items
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
        LIMIT 1`,
      [tenantId, workflowId, parentWorkItemId],
    );
    if (!parentResult.rowCount) {
      throw new ValidationError('Parent work item not found');
    }

    const descendantResult = await db.query<{ id: string }>(
      `WITH RECURSIVE descendants AS (
         SELECT id
           FROM workflow_work_items
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND id = $3
         UNION ALL
         SELECT wi.id
           FROM workflow_work_items wi
           JOIN descendants d
             ON wi.parent_work_item_id = d.id
          WHERE wi.tenant_id = $1
            AND wi.workflow_id = $2
       )
       SELECT id
         FROM descendants
        WHERE id = $4
        LIMIT 1`,
      [tenantId, workflowId, workItemId, parentWorkItemId],
    );
    if (descendantResult.rowCount) {
      throw new ValidationError('A work item cannot be reparented under one of its descendants');
    }
  }

  private async loadStage(
    tenantId: string,
    workflowId: string,
    stageName: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowStageRow>(
      `SELECT id, name, position, goal, guidance, human_gate, status, gate_status,
              iteration_count, summary, metadata, started_at, completed_at, updated_at
         FROM workflow_stages
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND name = $3
        FOR UPDATE`,
      [tenantId, workflowId, stageName],
    );
    if (!result.rowCount) {
      throw new NotFoundError(`Workflow stage '${stageName}' not found`);
    }
    return result.rows[0];
  }

  private async loadAwaitingGate(
    tenantId: string,
    workflowId: string,
    stageId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowStageGateRow>(
      `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
              concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
              updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at
         FROM workflow_stage_gates
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND stage_id = $3
          AND status = 'awaiting_approval'
        LIMIT 1`,
      [tenantId, workflowId, stageId],
    );
    return result.rows[0] ?? null;
  }

  private async loadAwaitingGateById(
    tenantId: string,
    gateId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowStageGateRow>(
      `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
              concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
              updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at
         FROM workflow_stage_gates
        WHERE tenant_id = $1
          AND id = $2
          AND status = 'awaiting_approval'
        LIMIT 1
        FOR UPDATE`,
      [tenantId, gateId],
    );
    return result.rows[0] ?? null;
  }

  private async loadGateById(
    tenantId: string,
    gateId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowStageGateRow>(
      `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
              concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
              updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at
         FROM workflow_stage_gates
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, gateId],
    );
    return result.rows[0] ?? null;
  }

  private async loadLatestGateForStage(
    tenantId: string,
    workflowId: string,
    stageId: string,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<WorkflowStageGateRow>(
      `SELECT id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
              concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
              updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at
         FROM workflow_stage_gates
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND stage_id = $3
        ORDER BY requested_at DESC
        LIMIT 1`,
      [tenantId, workflowId, stageId],
    );
    return result.rows[0] ?? null;
  }

  private async hasNewStageHandoffSinceGateDecision(
    tenantId: string,
    workflowId: string,
    stageName: string,
    decidedAt: Date,
    db: DatabaseClient | DatabasePool,
  ) {
    const result = await db.query<{ has_rework: boolean }>(
      `SELECT EXISTS (
          SELECT 1
            FROM task_handoffs h
            JOIN tasks t
              ON t.tenant_id = h.tenant_id
             AND t.id = h.task_id
           WHERE h.tenant_id = $1
             AND h.workflow_id = $2
             AND h.stage_name = $3
             AND h.created_at > $4
             AND COALESCE(t.role, '') <> 'orchestrator'
        ) AS has_rework`,
      [tenantId, workflowId, stageName, decidedAt],
    );
    return result.rows[0]?.has_rework ?? false;
  }

  private async applyGateDecision(
    identity: ApiKeyIdentity,
    workflowId: string,
    stage: WorkflowStageRow,
    gate: WorkflowStageGateRow,
    input: StageGateDecisionInput,
    client?: DatabaseClient,
  ) {
    const db = client ?? this.deps.pool;
    const decisionState =
      input.action === 'approve'
        ? { gate_status: 'approved', status: 'awaiting_gate', iterations: stage.iteration_count }
        : input.action === 'request_changes'
          ? { gate_status: 'changes_requested', status: 'active', iterations: stage.iteration_count + 1 }
          : { gate_status: 'rejected', status: 'blocked', iterations: stage.iteration_count + 1 };
    const feedback = nullableText(input.feedback);

    const updatedGateResult = await db.query<WorkflowStageGateRow>(
      `UPDATE workflow_stage_gates
          SET status = $4,
              decision_feedback = $5,
              decided_by_type = $6,
              decided_by_id = $7,
              decided_at = now(),
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND id = $3
      RETURNING id, workflow_id, stage_id, stage_name, status, request_summary, recommendation,
                concerns, key_artifacts, requested_by_type, requested_by_id, requested_at,
                updated_at, decided_by_type, decided_by_id, decision_feedback, decided_at`,
      [
        identity.tenantId,
        workflowId,
        gate.id,
        decisionState.gate_status,
        feedback,
        identity.scope,
        identity.keyPrefix,
      ],
    );

    const updatedStage = await db.query<WorkflowStageRow>(
      `UPDATE workflow_stages
          SET gate_status = $4,
              status = $5,
              iteration_count = $6,
              updated_at = now()
        WHERE tenant_id = $1
          AND workflow_id = $2
          AND name = $3
      RETURNING id, name, position, goal, guidance, human_gate, status, gate_status,
                iteration_count, summary, metadata, started_at, completed_at, updated_at`,
      [
        identity.tenantId,
        workflowId,
        stage.name,
        decisionState.gate_status,
        decisionState.status,
        decisionState.iterations,
      ],
    );

    if (input.action === 'request_changes') {
      await db.query(
        `UPDATE workflow_work_items
            SET next_expected_actor = COALESCE(owner_role, next_expected_actor),
                next_expected_action = 'rework',
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND stage_name = $3
            AND completed_at IS NULL`,
        [identity.tenantId, workflowId, stage.name],
      );
    } else {
      await db.query(
        `UPDATE workflow_work_items
            SET next_expected_actor = NULL,
                next_expected_action = NULL,
                updated_at = now()
          WHERE tenant_id = $1
            AND workflow_id = $2
            AND stage_name = $3
            AND next_expected_action IN ('approve', 'rework')`,
        [identity.tenantId, workflowId, stage.name],
      );
    }

    await this.deps.eventService.emit(
      {
        tenantId: identity.tenantId,
        type: `stage.gate.${input.action}`,
        entityType: 'gate',
        entityId: gate.id,
        actorType: identity.scope,
        actorId: identity.keyPrefix,
        data: {
          workflow_id: workflowId,
          stage_name: stage.name,
          feedback,
          gate_id: gate.id,
        },
      },
      client,
    );

    const activation = await this.deps.activationService.enqueueForWorkflow(
      {
        tenantId: identity.tenantId,
        workflowId,
        reason: `stage.gate.${input.action}`,
        eventType: `stage.gate.${input.action}`,
        payload: { stage_name: stage.name, feedback, gate_id: gate.id },
        actorType: identity.scope,
        actorId: identity.keyPrefix,
      },
      client,
    );
    await this.deps.activationDispatchService.dispatchActivation(
      identity.tenantId,
      String(activation.id),
      client,
    );

    await this.deps.stateService.recomputeWorkflowState(identity.tenantId, workflowId, client, {
      actorType: identity.scope,
      actorId: identity.keyPrefix,
    });
    return {
      gate: updatedGateResult.rows[0],
      stage: updatedStage.rows[0],
      activation,
    };
  }
}

function nextStageNameFor(definition: PlaybookDefinition, currentStageName: string): string | null {
  const index = definition.stages.findIndex((stage) => stage.name === currentStageName);
  if (index === -1) {
    return null;
  }
  return definition.stages[index + 1]?.name ?? null;
}

function nullableText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalTimestamp(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeConcernList(value?: string[]) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeArtifactList(
  value?: Array<{ id?: string; task_id?: string; label?: string; path?: string }>,
) {
  if (!Array.isArray(value)) {
    return [] as Array<Record<string, string>>;
  }
  return value
    .map((artifact) => {
      const normalized = {
        ...(artifact.id?.trim() ? { id: artifact.id.trim() } : {}),
        ...(artifact.task_id?.trim() ? { task_id: artifact.task_id.trim() } : {}),
        ...(artifact.label?.trim() ? { label: artifact.label.trim() } : {}),
        ...(artifact.path?.trim() ? { path: artifact.path.trim() } : {}),
      };
      return normalized;
    })
    .filter((artifact) => Object.keys(artifact).length > 0);
}

function nullableTextOrNull(value: string | null | undefined, fallback: string | null): string | null {
  return value === undefined ? fallback : nullableText(value);
}

function isIdempotentGateDecision(
  gate: WorkflowStageGateRow | null,
  input: StageGateDecisionInput,
) {
  if (!gate) {
    return false;
  }
  return gate.status === gateStatusForAction(input.action);
}

function isFollowOnGateDecisionAllowed(
  gate: WorkflowStageGateRow | null,
  input: StageGateDecisionInput,
) {
  if (!gate) {
    return false;
  }
  return gate.status === 'changes_requested' && input.action === 'approve';
}

function isIdempotentGateRequest(
  gate: WorkflowStageGateRow,
  input: StageGateRequestInput,
) {
  return gate.status === 'awaiting_approval'
    && gate.request_summary === input.summary.trim()
    && gate.recommendation === nullableText(input.recommendation)
    && sameStringArray(normalizeConcernList(input.concerns), normalizeStringArray(gate.concerns))
    && sameRecordArray(normalizeArtifactList(input.key_artifacts), normalizeRecordArray(gate.key_artifacts));
}

function isIdempotentStageAdvance(
  currentStageName: string | null,
  sourceStage: WorkflowStageRow,
  nextStageName: string,
) {
  return sourceStage.status === 'completed' && currentStageName === nextStageName;
}

function terminalColumnIdFor(definition: ReturnType<typeof parsePlaybookDefinition>) {
  const terminalColumn = definition.board.columns.find((column) => column.is_terminal);
  return terminalColumn ? terminalColumn.id : null;
}

function readCompletionSummary(workflow: WorkflowContextRow) {
  const state = workflow.orchestration_state;
  if (!state || typeof state !== 'object') {
    return null;
  }
  const value = state.completion_summary;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readCompletionArtifacts(workflow: WorkflowContextRow) {
  const state = workflow.orchestration_state;
  if (!state || typeof state !== 'object') {
    return [] as string[];
  }
  return normalizeStringArray(state.final_artifacts);
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function normalizeRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as Array<Record<string, string>>;
  }
  return value.filter(
    (entry): entry is Record<string, string> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function sameStringArray(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function sameRecordArray(
  left: Array<Record<string, string>>,
  right: Array<Record<string, string>>,
) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => areJsonValuesEquivalent(value, right[index]));
}

function gateStatusForAction(action: StageGateDecisionInput['action']) {
  return action === 'approve'
    ? 'approved'
    : action === 'request_changes'
      ? 'changes_requested'
      : 'rejected';
}

function mergeRecord(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null | undefined,
) {
  return {
    ...(current ?? {}),
    ...(patch ?? {}),
  };
}

function normalizeWorkItemUpdate(
  current: WorkflowWorkItemRow,
  input: UpdateWorkflowWorkItemInput,
  resolved: {
    parentWorkItemId: string | null;
    stageName: string;
    columnId: string;
    terminalColumns: Set<string>;
  },
): NormalizedWorkItemUpdate {
  return {
    parent_work_item_id: resolved.parentWorkItemId,
    title: input.title?.trim() || current.title,
    goal: nullableTextOrNull(input.goal, current.goal),
    acceptance_criteria: nullableTextOrNull(input.acceptance_criteria, current.acceptance_criteria),
    stage_name: resolved.stageName,
    column_id: resolved.columnId,
    owner_role: nullableTextOrNull(input.owner_role, current.owner_role),
    priority: input.priority ?? current.priority,
    notes: nullableTextOrNull(input.notes, current.notes),
    completed_at: resolved.terminalColumns.has(resolved.columnId)
      ? current.completed_at ?? new Date()
      : null,
    metadata: mergeRecord(current.metadata, input.metadata),
  };
}

function sameNormalizedWorkItem(
  current: WorkflowWorkItemRow,
  next: NormalizedWorkItemUpdate,
) {
  return current.parent_work_item_id === next.parent_work_item_id
    && current.title === next.title
    && current.goal === next.goal
    && current.acceptance_criteria === next.acceptance_criteria
    && current.stage_name === next.stage_name
    && current.column_id === next.column_id
    && current.owner_role === next.owner_role
    && current.priority === next.priority
    && current.notes === next.notes
    && sameCompletionState(current.completed_at, next.completed_at)
    && areJsonValuesEquivalent(current.metadata ?? {}, next.metadata);
}

function sameCompletionState(left: Date | null, right: Date | null) {
  return (left === null) === (right === null);
}

async function emitWorkItemEvent(
  deps: Dependencies,
  identity: ApiKeyIdentity,
  workflowId: string,
  workItemId: string,
  type: string,
  data: Record<string, unknown>,
  client: DatabaseClient,
) {
  await deps.eventService.emit(
    {
      tenantId: identity.tenantId,
      type,
      entityType: 'work_item',
      entityId: workItemId,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        workflow_id: workflowId,
        ...data,
      },
    },
    client,
  );
}

function buildWorkItemUpdatePayload(previous: WorkflowWorkItemRow, current: WorkflowWorkItemRow) {
  return {
    work_item_id: current.id,
    previous_parent_work_item_id: previous.parent_work_item_id,
    parent_work_item_id: current.parent_work_item_id,
    previous_stage_name: previous.stage_name,
    stage_name: current.stage_name,
    previous_column_id: previous.column_id,
    column_id: current.column_id,
    completed_at: current.completed_at?.toISOString() ?? null,
  };
}

async function emitWorkItemUpdateEvents(
  deps: Dependencies,
  identity: ApiKeyIdentity,
  workflowId: string,
  previous: WorkflowWorkItemRow,
  current: WorkflowWorkItemRow,
  client: DatabaseClient,
) {
  const basePayload = buildWorkItemUpdatePayload(previous, current);
  await emitWorkItemEvent(deps, identity, workflowId, current.id, 'work_item.updated', basePayload, client);

  if (
    previous.stage_name !== current.stage_name ||
    previous.column_id !== current.column_id
  ) {
    await emitWorkItemEvent(deps, identity, workflowId, current.id, 'work_item.moved', basePayload, client);
  }

  if (previous.parent_work_item_id !== current.parent_work_item_id) {
    await emitWorkItemEvent(
      deps,
      identity,
      workflowId,
      current.id,
      'work_item.reparented',
      basePayload,
      client,
    );
  }

  if (!previous.completed_at && current.completed_at) {
    await emitWorkItemEvent(
      deps,
      identity,
      workflowId,
      current.id,
      'work_item.completed',
      basePayload,
      client,
    );
  }

  if (previous.completed_at && !current.completed_at) {
    await emitWorkItemEvent(
      deps,
      identity,
      workflowId,
      current.id,
      'work_item.reopened',
      basePayload,
      client,
    );
  }
}

function toWorkItemResponse(row: WorkflowWorkItemRow): WorkflowWorkItemResponse {
  return {
    ...row,
    completed_at: row.completed_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

function toStageResponse(row: WorkflowStageRow) {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    goal: row.goal,
    guidance: row.guidance,
    human_gate: row.human_gate,
    status: row.status,
    gate_status: row.gate_status,
    iteration_count: row.iteration_count,
    summary: row.summary,
    metadata: row.metadata ?? {},
    started_at: row.started_at?.toISOString() ?? null,
    completed_at: row.completed_at?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

function toStageDecisionResponse(
  row: WorkflowStageRow,
  activation?: Record<string, unknown> | null,
) {
  const stage = toStageResponse(row);
  if (!activation) {
    return stage;
  }
  return {
    ...stage,
    orchestrator_resume: {
      activation_id: activation.activation_id ?? activation.id ?? null,
      state: activation.state ?? null,
      event_type: activation.event_type ?? null,
      reason: activation.reason ?? null,
      queued_at: parseOptionalTimestamp(asString(activation.queued_at)),
      started_at: parseOptionalTimestamp(asString(activation.started_at)),
      completed_at: parseOptionalTimestamp(asString(activation.completed_at)),
      summary: activation.summary ?? null,
      error: activation.error ?? null,
    },
  };
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null;
}
