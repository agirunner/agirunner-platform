import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { LogService } from '../../logging/log-service.js';
import type { TaskState } from '../../orchestration/task-state-machine.js';
import type { ArtifactService } from '../artifacts/artifact-service.js';
import type { ExecutionContainerLeaseService } from '../execution-environment/execution-container-lease-service.js';
import type { EventService } from '../event/event-service.js';
import type { HandoffService } from '../handoff-service/handoff-service.js';
import type { PlaybookTaskParallelismService } from '../playbook/playbook-task-parallelism-service.js';
import type { ImmediateWorkflowActivationDispatcher } from '../workflow-activation/workflow-immediate-activation.js';
import type { WorkflowStateService } from '../workflow-state-service.js';
import type { WorkItemContinuityService } from '../work-item-continuity-service/work-item-continuity-service.js';
import type { LifecyclePolicy } from './task-lifecycle-policy.js';
import type {
  FailureClassification,
} from './task-lifecycle-service-helpers.js';
import type {
  LatestAssessmentRequestHandoffRow,
} from './task-lifecycle-service-helpers.js';

export interface TransitionOptions {
  expectedStates: TaskState[];
  requireAssignment?: { agentId?: string; workerId?: string };
  output?: unknown;
  error?: unknown;
  metrics?: Record<string, unknown>;
  gitInfo?: Record<string, unknown>;
  verification?: Record<string, unknown>;
  reason?: string;
  retryIncrement?: boolean;
  reworkIncrement?: boolean;
  clearAssignment?: boolean;
  clearExecutionData?: boolean;
  clearLifecycleControlMetadata?: boolean;
  clearEscalationMetadata?: boolean;
  startedAt?: Date;
  overrideInput?: Record<string, unknown>;
  metadataPatch?: Record<string, unknown>;
  afterUpdate?: (
    updatedTask: Record<string, unknown>,
    client: DatabaseClient,
  ) => Promise<void>;
}

export interface TaskLifecycleDependencies {
  pool: DatabasePool;
  eventService: EventService;
  logService?: LogService;
  activationDispatchService?: ImmediateWorkflowActivationDispatcher;
  workflowStateService: WorkflowStateService;
  defaultTaskTimeoutMinutes?: number;
  loadTaskOrThrow: (
    tenantId: string,
    taskId: string,
    client?: DatabaseClient,
  ) => Promise<Record<string, unknown>>;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  artifactService?: Pick<ArtifactService, 'uploadTaskArtifact' | 'deleteTaskArtifact'>;
  queueWorkerCancelSignal?: (
    identity: ApiKeyIdentity,
    workerId: string,
    taskId: string,
    reason: 'manual_cancel' | 'task_timeout',
    requestedAt: Date,
  ) => Promise<string | null>;
  getRoleByName?: (
    tenantId: string,
    name: string,
  ) => Promise<{ escalation_target: string | null; max_escalation_depth: number } | null>;
  finalizeOrchestratorActivation?: (
    tenantId: string,
    task: Record<string, unknown>,
    status: 'completed' | 'failed' | 'escalated',
    client: DatabaseClient,
  ) => Promise<void>;
  evaluateWorkflowBudget?: (
    tenantId: string,
    workflowId: string,
    client: DatabaseClient,
  ) => Promise<void>;
  parallelismService?: PlaybookTaskParallelismService;
  workItemContinuityService?: Pick<
    WorkItemContinuityService,
    'clearAssessmentExpectation' | 'recordAssessmentRequestedChanges' | 'recordTaskCompleted'
  >;
  handoffService?: Pick<HandoffService, 'assertRequiredTaskHandoffBeforeCompletion'>;
  executionContainerLeaseService?: Pick<ExecutionContainerLeaseService, 'releaseForTask'>;
}

export interface TaskLifecycleServiceOperationContext {
  deps: TaskLifecycleDependencies;
  clearOpenChildAssessmentWorkItemRouting(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  restoreOpenChildAssessmentWorkItemRouting(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  reopenCompletedWorkItemForRework(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  reconcileWorkItemExecutionColumn(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  logGovernanceTransition(
    tenantId: string,
    operation: string,
    task: Record<string, unknown>,
    payload: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  requireLifecycleIdentity(
    identity: ApiKeyIdentity,
    payload?: { agent_id?: string; worker_id?: string },
  ): { agentId?: string; workerId?: string };
  extractOutputSchema(task: Record<string, unknown>): Record<string, unknown> | undefined;
  readVerificationPassed(
    verification: Record<string, unknown> | undefined,
    metrics: Record<string, unknown> | undefined,
  ): boolean | undefined;
  lockWorkflowRowForTask(
    tenantId: string,
    task: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  applyStateTransition(
    identity: ApiKeyIdentity,
    taskId: string,
    nextState: TaskState,
    options: TransitionOptions,
    existingClient?: DatabaseClient,
  ): Promise<Record<string, unknown>>;
  resolveNextState(
    tenantId: string,
    task: Record<string, unknown>,
    requestedState: TaskState,
    client: DatabaseClient,
  ): Promise<TaskState>;
  resolveCreatedSpecialistTaskState(
    tenantId: string,
    task: {
      workflow_id?: string | null;
      work_item_id?: string | null;
      is_orchestrator_task?: boolean;
    },
    client: DatabaseClient,
  ): Promise<'ready' | 'pending'>;
  assertOperatorReportingBeforeCompletion(
    tenantId: string,
    task: Record<string, unknown>,
    client?: DatabaseClient,
  ): Promise<void>;
  loadLatestAssessmentRequestHandoff(
    tenantId: string,
    task: Record<string, unknown>,
    db?: DatabaseClient,
  ): Promise<LatestAssessmentRequestHandoffRow | null>;
  loadLatestTaskAttemptHandoffCreatedAt(
    tenantId: string,
    task: Record<string, unknown>,
    db?: DatabaseClient,
  ): Promise<Date | null>;
  requestTaskChanges(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      feedback: string;
      override_input?: Record<string, unknown>;
      preferred_agent_id?: string;
      preferred_worker_id?: string;
    },
    client?: DatabaseClient,
  ): Promise<Record<string, unknown>>;
  rejectTask(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: { feedback: string; record_continuity?: boolean },
    client?: DatabaseClient,
  ): Promise<Record<string, unknown>>;
  enqueuePlaybookActivationIfNeeded(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    eventType: string,
    payload: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  maybeResolveEscalationSource(
    identity: ApiKeyIdentity,
    completedTask: Record<string, unknown>,
    client: DatabaseClient,
  ): Promise<void>;
  maybeOpenTaskWorkItemEscalation(
    tenantId: string,
    task: Record<string, unknown>,
    reason: string,
    client: DatabaseClient,
  ): Promise<void>;
  maybeResolveTaskWorkItemEscalation(
    tenantId: string,
    task: Record<string, unknown>,
    resolutionAction: 'dismiss' | 'unblock_subject' | 'reopen_subject',
    feedback: string | null,
    resolvedByType: string,
    resolvedById: string,
    client: DatabaseClient,
  ): Promise<void>;
  createEscalationTaskForRole(
    identity: ApiKeyIdentity,
    sourceTask: Record<string, unknown>,
    targetRole: string,
    escalationContext: {
      reason: string;
      context_summary?: string;
      work_so_far?: string;
    },
    depth: number,
    client: DatabaseClient,
  ): Promise<Record<string, unknown>>;
  maybeCreateEscalationTask(
    identity: ApiKeyIdentity,
    task: Record<string, unknown>,
    lifecyclePolicy: LifecyclePolicy | undefined,
    failure: FailureClassification,
    client: DatabaseClient,
  ): Promise<void>;
  resolveInheritedTaskTimeoutMinutes(
    tenantId: string,
    explicitValue: unknown,
    client: DatabaseClient,
  ): Promise<number>;
}
