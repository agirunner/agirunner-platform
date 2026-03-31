import type { FastifyInstance } from 'fastify';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';
import { buildArtifactStorageConfig } from '../../../content/storage-config.js';
import { createArtifactStorage } from '../../../content/storage-factory.js';
import { ArtifactService } from '../../../services/artifacts/artifact-service.js';
import { GuidedClosureRecoveryHelpersService } from '../../../services/guided-closure/recovery-helpers.js';
import { HandoffService } from '../../../services/handoff-service/handoff-service.js';
import { OrchestratorActivationCheckpointService } from '../../../services/orchestrator/orchestrator-activation-checkpoint-service.js';
import { OrchestratorTaskMessageService } from '../../../services/orchestrator/orchestrator-task-message-service.js';
import { readWorkerDispatchAckTimeoutMs } from '../../../services/platform-timing-defaults.js';
import { PlaybookWorkflowControlService } from '../../../services/playbook-workflow-control/playbook-workflow-control-service.js';
import { TaskAgentScopeService } from '../../../services/task-agent-scope-service.js';
import { WorkItemContinuityService } from '../../../services/work-item-continuity-service/work-item-continuity-service.js';
import { WorkflowActivationDispatchService } from '../../../services/workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from '../../../services/workflow-activation/workflow-activation-service.js';
import { WorkflowDeliverableService } from '../../../services/workflow-deliverable-service.js';
import { WorkflowStateService } from '../../../services/workflow-state-service.js';
import { WorkflowToolResultService } from '../../../services/workflow-tool-result-service.js';

import { loadManagedSpecialistTask } from './shared.js';

export interface OrchestratorControlRouteContext {
  app: FastifyInstance;
  toolResultService: WorkflowToolResultService;
  taskScopeService: TaskAgentScopeService;
  activationCheckpointService: OrchestratorActivationCheckpointService;
  workItemContinuityService: WorkItemContinuityService;
  artifactService: ArtifactService;
  taskMessageService: OrchestratorTaskMessageService;
  handoffService: HandoffService;
  playbookControlService: PlaybookWorkflowControlService;
  recoveryHelpers: GuidedClosureRecoveryHelpersService;
  withManagedSpecialistTask: (
    identity: ApiKeyIdentity,
    orchestratorTaskId: string,
    managedTaskId: string,
  ) => Promise<Awaited<ReturnType<TaskAgentScopeService['loadAgentOwnedOrchestratorTask']>>>;
}

export function buildOrchestratorControlRouteContext(
  app: FastifyInstance,
): OrchestratorControlRouteContext {
  const toolResultService = new WorkflowToolResultService(app.pgPool);
  const taskScopeService = new TaskAgentScopeService(app.pgPool);
  const activationCheckpointService = new OrchestratorActivationCheckpointService(app.pgPool);
  const workItemContinuityService = new WorkItemContinuityService(app.pgPool, app.logService);
  const artifactService = new ArtifactService(
    app.pgPool,
    createArtifactStorage(buildArtifactStorageConfig(app.config)),
    app.config.ARTIFACT_ACCESS_URL_TTL_SECONDS,
    app.config.ARTIFACT_PREVIEW_MAX_BYTES,
  );
  const taskMessageService = new OrchestratorTaskMessageService(
    app.pgPool,
    app.eventService,
    app.workerConnectionHub,
    {
      readStaleAfterMs: (tenantId) => readWorkerDispatchAckTimeoutMs(app.pgPool, tenantId),
    },
  );
  const handoffService = new HandoffService(app.pgPool);
  const playbookControlService = new PlaybookWorkflowControlService({
    pool: app.pgPool,
    eventService: app.eventService,
    stateService: new WorkflowStateService(app.pgPool, app.eventService),
    activationService: new WorkflowActivationService(app.pgPool, app.eventService),
    activationDispatchService: new WorkflowActivationDispatchService({
      pool: app.pgPool,
      eventService: app.eventService,
      config: app.config,
    }),
    subjectTaskChangeService: app.taskService,
    workflowDeliverableService: new WorkflowDeliverableService(app.pgPool),
  });
  const recoveryHelpers = new GuidedClosureRecoveryHelpersService({
    pool: app.pgPool,
    eventService: app.eventService,
    taskService: app.taskService,
    workflowControlService: playbookControlService,
  });

  return {
    app,
    toolResultService,
    taskScopeService,
    activationCheckpointService,
    workItemContinuityService,
    artifactService,
    taskMessageService,
    handoffService,
    playbookControlService,
    recoveryHelpers,
    withManagedSpecialistTask: async (identity, orchestratorTaskId, managedTaskId) => {
      const taskScope = await taskScopeService.loadAgentOwnedOrchestratorTask(
        identity,
        orchestratorTaskId,
      );
      await loadManagedSpecialistTask(app, identity, taskScope.workflow_id, managedTaskId);
      return taskScope;
    },
  };
}
