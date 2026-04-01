import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient } from '../../db/database.js';
import { ForbiddenError } from '../../errors/domain-errors.js';
import { logTaskGovernanceTransition } from '../../logging/workflow-events/task-governance-log.js';
import type { TaskState } from '../../orchestration/task-state-machine.js';
import {
  asRecord,
  readOptionalText,
} from './task-lifecycle-service-helpers.js';
import {
  clearOpenChildAssessmentWorkItemRouting,
  reconcileWorkItemExecutionColumn,
  reopenCompletedWorkItemForRework,
  restoreOpenChildAssessmentWorkItemRouting,
} from './task-lifecycle-work-item-helpers.js';
import {
  enqueuePlaybookActivationIfNeeded,
  maybeOpenTaskWorkItemEscalation,
  maybeResolveTaskWorkItemEscalation,
} from './task-lifecycle-escalation-helpers.js';
import {
  applyStateTransition as applyStateTransitionOperation,
  resolveCreatedSpecialistTaskState as resolveCreatedSpecialistTaskStateOperation,
  resolveNextState as resolveNextStateOperation,
} from './task-lifecycle-service-transition-operations.js';
import {
  assertOperatorReportingBeforeCompletion,
  loadLatestAssessmentRequestHandoff,
  loadLatestTaskAttemptHandoffCreatedAt,
} from './task-lifecycle-service-query-helpers.js';
import {
  completeTask as completeTaskOperation,
  failTask as failTaskOperation,
  startTask as startTaskOperation,
} from './task-lifecycle-service-completion-operations.js';
import {
  approveTask as approveTaskOperation,
  approveTaskOutput as approveTaskOutputOperation,
  cancelTask as cancelTaskOperation,
  reassignTask as reassignTaskOperation,
  rejectTask as rejectTaskOperation,
  requestTaskChanges as requestTaskChangesOperation,
  retryTask as retryTaskOperation,
} from './task-lifecycle-service-review-operations.js';
import {
  overrideTaskOutput as overrideTaskOutputOperation,
  skipTask as skipTaskOperation,
} from './task-lifecycle-service-review-output-operations.js';
import {
  agentEscalate as agentEscalateOperation,
  escalateTask as escalateTaskOperation,
} from './task-lifecycle-service-escalation-operations.js';
import {
  resolveEscalation as resolveEscalationOperation,
  respondToEscalation as respondToEscalationOperation,
} from './task-lifecycle-service-escalation-resolution-operations.js';
import {
  createEscalationTaskForRole,
  maybeCreateEscalationTask,
  maybeResolveEscalationSource,
  resolveInheritedTaskTimeoutMinutes,
} from './task-lifecycle-service-escalation-support.js';
import type {
  TaskLifecycleDependencies,
  TaskLifecycleServiceOperationContext,
  TransitionOptions,
} from './task-lifecycle-service-types.js';

export class TaskLifecycleService {
  constructor(private readonly deps: TaskLifecycleDependencies) {}

  private createContext(): TaskLifecycleServiceOperationContext {
    const context: TaskLifecycleServiceOperationContext = {
      deps: this.deps,
      clearOpenChildAssessmentWorkItemRouting: (tenantId, task, client) =>
        clearOpenChildAssessmentWorkItemRouting(tenantId, task, client),
      restoreOpenChildAssessmentWorkItemRouting: (tenantId, task, client) =>
        restoreOpenChildAssessmentWorkItemRouting(tenantId, task, client),
      reopenCompletedWorkItemForRework: (identity, task, client) =>
        reopenCompletedWorkItemForRework({
          identity,
          task,
          client,
          eventService: this.deps.eventService,
        }),
      reconcileWorkItemExecutionColumn: (identity, task, client) =>
        reconcileWorkItemExecutionColumn({
          identity,
          task,
          client,
          eventService: this.deps.eventService,
        }),
      logGovernanceTransition: async (tenantId, operation, task, payload, client) => {
        await logTaskGovernanceTransition(this.deps.logService, {
          tenantId,
          operation,
          executor: client,
          task,
          payload,
        });
      },
      requireLifecycleIdentity: (identity, payload) =>
        this.requireLifecycleIdentity(identity, payload),
      extractOutputSchema: (task) => this.extractOutputSchema(task),
      readVerificationPassed: (verification, metrics) =>
        this.readVerificationPassed(verification, metrics),
      lockWorkflowRowForTask: (tenantId, task, client) =>
        this.lockWorkflowRowForTask(tenantId, task, client),
      applyStateTransition: (identity, taskId, nextState, options, existingClient) =>
        applyStateTransitionOperation(context, identity, taskId, nextState, options, existingClient),
      resolveNextState: (tenantId, task, requestedState, client) =>
        resolveNextStateOperation(context, tenantId, task, requestedState, client),
      resolveCreatedSpecialistTaskState: (tenantId, task, client) =>
        resolveCreatedSpecialistTaskStateOperation(context, tenantId, task, client),
      assertOperatorReportingBeforeCompletion: (tenantId, task, client) =>
        assertOperatorReportingBeforeCompletion(context, tenantId, task, client),
      loadLatestAssessmentRequestHandoff: (tenantId, task, db) =>
        loadLatestAssessmentRequestHandoff(context, tenantId, task, db),
      loadLatestTaskAttemptHandoffCreatedAt: (tenantId, task, db) =>
        loadLatestTaskAttemptHandoffCreatedAt(context, tenantId, task, db),
      requestTaskChanges: (identity, taskId, payload, client) =>
        requestTaskChangesOperation(context, identity, taskId, payload, client),
      rejectTask: (identity, taskId, payload, client) =>
        rejectTaskOperation(context, identity, taskId, payload, client),
      enqueuePlaybookActivationIfNeeded: (identity, task, eventType, payload, client) =>
        enqueuePlaybookActivationIfNeeded({
          identity,
          task,
          eventType,
          payload,
          client,
          eventService: this.deps.eventService,
          activationDispatchService: this.deps.activationDispatchService,
        }),
      maybeResolveEscalationSource: (identity, task, client) =>
        maybeResolveEscalationSource(context, identity, task, client),
      maybeOpenTaskWorkItemEscalation: (tenantId, task, reason, client) =>
        maybeOpenTaskWorkItemEscalation(tenantId, task, reason, client),
      maybeResolveTaskWorkItemEscalation: (
        tenantId,
        task,
        resolutionAction,
        feedback,
        resolvedByType,
        resolvedById,
        client,
      ) =>
        maybeResolveTaskWorkItemEscalation(
          tenantId,
          task,
          resolutionAction,
          feedback,
          resolvedByType,
          resolvedById,
          client,
        ),
      createEscalationTaskForRole: (
        identity,
        sourceTask,
        targetRole,
        escalationContext,
        depth,
        client,
      ) =>
        createEscalationTaskForRole(
          context,
          identity,
          sourceTask,
          targetRole,
          escalationContext,
          depth,
          client,
        ),
      maybeCreateEscalationTask: (identity, task, lifecyclePolicy, failure, client) =>
        maybeCreateEscalationTask(context, identity, task, lifecyclePolicy, failure, client),
      resolveInheritedTaskTimeoutMinutes: (tenantId, explicitValue, client) =>
        resolveInheritedTaskTimeoutMinutes(context, tenantId, explicitValue, client),
    };
    return context;
  }

  private requireLifecycleIdentity(
    identity: ApiKeyIdentity,
    payload: { agent_id?: string; worker_id?: string } = {},
  ): { agentId?: string; workerId?: string } {
    if (identity.scope === 'agent') {
      if (!identity.ownerId) {
        throw new ForbiddenError('Agent identity is required for task lifecycle operations');
      }
      if (payload.agent_id && payload.agent_id !== identity.ownerId) {
        throw new ForbiddenError('Task lifecycle operation can only target the calling agent');
      }
      return { agentId: identity.ownerId, workerId: payload.worker_id };
    }
    if (identity.scope === 'worker') {
      if (!identity.ownerId) {
        throw new ForbiddenError('Specialist Agent identity is required for task lifecycle operations');
      }
      if (payload.worker_id && payload.worker_id !== identity.ownerId) {
        throw new ForbiddenError('Task lifecycle operation can only target the calling Specialist Agent');
      }
      return { agentId: payload.agent_id, workerId: identity.ownerId };
    }
    throw new ForbiddenError('Specialist Execution or Specialist Agent identity is required for task lifecycle operations');
  }

  private extractOutputSchema(task: Record<string, unknown>): Record<string, unknown> | undefined {
    if (task.output_schema && typeof task.output_schema === 'object' && !Array.isArray(task.output_schema)) {
      return task.output_schema as Record<string, unknown>;
    }
    const schema = asRecord(task.role_config).output_schema;
    return schema && typeof schema === 'object' && !Array.isArray(schema)
      ? schema as Record<string, unknown>
      : undefined;
  }

  private readVerificationPassed(
    verification: Record<string, unknown> | undefined,
    metrics: Record<string, unknown> | undefined,
  ): boolean | undefined {
    if (typeof verification?.passed === 'boolean') {
      return verification.passed;
    }
    if (typeof metrics?.verification_passed === 'boolean') {
      return metrics.verification_passed as boolean;
    }
    return undefined;
  }

  private async lockWorkflowRowForTask(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void> {
    const workflowId = readOptionalText(task.workflow_id);
    if (!workflowId) {
      return;
    }
    await client.query(
      `SELECT id
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2
        FOR UPDATE`,
      [tenantId, workflowId],
    );
  }

  async applyStateTransition(
    identity: ApiKeyIdentity,
    taskId: string,
    nextState: TaskState,
    options: TransitionOptions,
    existingClient?: DatabaseClient,
  ) {
    return applyStateTransitionOperation(
      this.createContext(),
      identity,
      taskId,
      nextState,
      options,
      existingClient,
    );
  }

  private async resolveNextState(
    tenantId: string,
    task: Record<string, unknown>,
    requestedState: TaskState,
    client: DatabaseClient,
  ): Promise<TaskState> {
    return resolveNextStateOperation(this.createContext(), tenantId, task, requestedState, client);
  }

  private async resolveCreatedSpecialistTaskState(
    tenantId: string,
    task: {
      workflow_id?: string | null;
      work_item_id?: string | null;
      is_orchestrator_task?: boolean;
    },
    client: DatabaseClient,
  ): Promise<'ready' | 'pending'> {
    return resolveCreatedSpecialistTaskStateOperation(this.createContext(), tenantId, task, client);
  }

  async startTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { agent_id?: string; worker_id?: string; started_at?: string },
    existingClient?: DatabaseClient,
  ) {
    return startTaskOperation(this.createContext(), identity, taskId, payload, existingClient);
  }

  async completeTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      output: unknown;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      verification?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
    existingClient?: DatabaseClient,
  ) {
    return completeTaskOperation(this.createContext(), identity, taskId, payload, existingClient);
  }

  async failTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      error: Record<string, unknown>;
      metrics?: Record<string, unknown>;
      git_info?: Record<string, unknown>;
      agent_id?: string;
      worker_id?: string;
    },
    existingClient?: DatabaseClient,
  ) {
    return failTaskOperation(this.createContext(), identity, taskId, payload, existingClient);
  }

  async approveTask(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    return approveTaskOperation(this.createContext(), identity, taskId, client);
  }

  async approveTaskOutput(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    return approveTaskOutputOperation(this.createContext(), identity, taskId, client);
  }

  async retryTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { override_input?: Record<string, unknown>; force?: boolean } = {},
    client?: DatabaseClient,
  ) {
    return retryTaskOperation(this.createContext(), identity, taskId, payload, client);
  }

  async cancelTask(identity: ApiKeyIdentity, taskId: string, client?: DatabaseClient) {
    return cancelTaskOperation(this.createContext(), identity, taskId, client);
  }

  async rejectTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { feedback: string; record_continuity?: boolean },
    client?: DatabaseClient,
  ) {
    return rejectTaskOperation(this.createContext(), identity, taskId, payload, client);
  }

  async requestTaskChanges(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
    client?: DatabaseClient,
  ) {
    return requestTaskChangesOperation(this.createContext(), identity, taskId, payload, client);
  }

  async skipTask(identity: ApiKeyIdentity, taskId: string, payload: { reason: string }) {
    return skipTaskOperation(this.createContext(), identity, taskId, payload);
  }

  async reassignTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { preferred_agent_id?: string; preferred_worker_id?: string; reason: string },
    client?: DatabaseClient,
  ) {
    return reassignTaskOperation(this.createContext(), identity, taskId, payload, client);
  }

  async escalateTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      reason: string;
      escalation_target?: string;
      context?: Record<string, unknown>;
      recommendation?: string;
      blocking_task_id?: string;
      urgency?: 'info' | 'important' | 'critical';
    },
    client?: DatabaseClient,
  ) {
    return escalateTaskOperation(this.createContext(), identity, taskId, payload, client);
  }

  async overrideTaskOutput(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { output: unknown; reason: string },
  ) {
    return overrideTaskOutputOperation(this.createContext(), identity, taskId, payload);
  }

  async respondToEscalation(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { instructions: string; context?: Record<string, unknown> },
  ) {
    return respondToEscalationOperation(this.createContext(), identity, taskId, payload);
  }

  async agentEscalate(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      reason: string;
      context_summary?: string;
      work_so_far?: string;
    },
  ) {
    return agentEscalateOperation(this.createContext(), identity, taskId, payload);
  }

  async resolveEscalation(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      instructions: string;
      context?: Record<string, unknown>;
    },
  ) {
    return resolveEscalationOperation(this.createContext(), identity, taskId, payload);
  }
}
