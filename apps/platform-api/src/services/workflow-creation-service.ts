import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import { defaultStageName, parsePlaybookDefinition } from '../orchestration/playbook-model.js';
import { resolveWorkflowConfig } from './config-hierarchy-service.js';
import { WorkflowActivationService } from './workflow-activation-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import type { CreateWorkflowInput } from './workflow-service.types.js';
import { EventService } from './event-service.js';
import type { ModelCatalogService } from './model-catalog-service.js';
import { currentStageNameFromStages, WorkflowStageService } from './workflow-stage-service.js';
import { WorkflowStateService } from './workflow-state-service.js';
import { readProjectSettingsExtras } from './project-settings.js';

interface WorkflowCreationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  activationService: WorkflowActivationService;
  activationDispatchService: WorkflowActivationDispatchService;
  stageService: WorkflowStageService;
  modelCatalogService: Pick<ModelCatalogService, 'validateModelOverride'>;
}

type CreatedWorkflow = Record<string, unknown> & {
  id: string;
  playbook_id: string | null;
  current_stage?: string | null;
  workflow_stages: unknown[];
  work_items: unknown[];
  activations: Array<Record<string, unknown>>;
};

type PersistedWorkflowRow = Record<string, unknown> & {
  id: string;
  playbook_id: string | null;
  current_stage: string | null;
  lifecycle: string | null;
};

export class WorkflowCreationService {
  constructor(private readonly deps: WorkflowCreationDeps) {}

  async createWorkflow(identity: ApiKeyIdentity, input: CreateWorkflowInput): Promise<CreatedWorkflow> {
    if (!input.playbook_id) {
      throw new ValidationError('Workflow requires playbook_id');
    }
    return this.createPlaybookWorkflow(identity, input);
  }

  private async createPlaybookWorkflow(
    identity: ApiKeyIdentity,
    input: CreateWorkflowInput,
  ): Promise<CreatedWorkflow> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const playbookResult = await client.query(
        `SELECT * FROM playbooks
          WHERE tenant_id = $1
            AND id = $2
            AND is_active = true`,
        [identity.tenantId, input.playbook_id],
      );
      if (!playbookResult.rowCount) {
        throw new NotFoundError('Playbook not found');
      }

      const playbook = playbookResult.rows[0] as Record<string, unknown>;
      const definition = parsePlaybookDefinition(playbook.definition);
      const projectConfig = await this.loadProjectConfig(identity.tenantId, input.project_id ?? null, client);
      await this.deps.modelCatalogService.validateModelOverride(
        identity.tenantId,
        input.config_overrides ? input.config_overrides.model_override : undefined,
        'workflow model_override',
      );
      const resolvedConfig = resolveWorkflowConfig(
        playbook.definition as Record<string, unknown>,
        projectConfig,
        input.config_overrides ?? {},
      );
      const initialStageName = initialWorkflowStageName(definition);
      const workflowResult = await client.query(
        `INSERT INTO workflows (
           tenant_id, project_id, playbook_id, playbook_version, name, state, lifecycle,
           current_stage, parameters, metadata, resolved_config, config_layers,
           instruction_config, token_budget, cost_cap_usd, max_duration_minutes, orchestration_state
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '{}'::jsonb)
         RETURNING *`,
        [
          identity.tenantId,
          input.project_id ?? null,
          playbook.id,
          playbook.version,
          input.name,
          definition.lifecycle,
          null,
          input.parameters ?? {},
          input.metadata ?? {},
          resolvedConfig.resolved,
          resolvedConfig.layers,
          input.instruction_config ?? null,
          input.budget?.token_budget ?? null,
          input.budget?.cost_cap_usd ?? null,
          input.budget?.max_duration_minutes ?? null,
        ],
      );
      const workflow = workflowResult.rows[0] as PersistedWorkflowRow;
      const createdStages = await this.deps.stageService.createStages(
        identity.tenantId,
        workflow.id as string,
        definition,
        client,
      );

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'workflow.created',
          entityType: 'workflow',
          entityId: workflow.id as string,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            playbook_id: playbook.id,
            playbook_version: playbook.version,
            lifecycle: definition.lifecycle,
          },
        },
        client,
      );

      if (definition.lifecycle === 'planned' && initialStageName) {
        await this.deps.eventService.emit(
          {
            tenantId: identity.tenantId,
            type: 'stage.started',
            entityType: 'workflow',
            entityId: workflow.id as string,
            actorType: identity.scope,
            actorId: identity.keyPrefix,
            data: { stage_name: initialStageName },
          },
          client,
        );
      }

      const activation = await this.deps.activationService.enqueueForWorkflow(
        {
          tenantId: identity.tenantId,
          workflowId: workflow.id as string,
          reason: 'workflow.created',
          eventType: 'workflow.created',
          payload: initialStageName ? { stage_name: initialStageName } : {},
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

      await client.query('COMMIT');
      return sanitizeCreatedWorkflow({
        ...workflow,
        current_stage:
          definition.lifecycle === 'planned'
            ? currentStageNameFromStages(createdStages as never)
            : null,
        workflow_stages: createdStages,
        work_items: [],
        activations: [activation],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadProjectConfig(
    tenantId: string,
    projectId: string | null,
    client: { query: DatabasePool['query'] },
  ): Promise<Record<string, unknown>> {
    if (!projectId) {
      return {};
    }

    const result = await client.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM projects WHERE tenant_id = $1 AND id = $2',
      [tenantId, projectId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Project not found');
    }
    return readProjectSettingsExtras(result.rows[0].settings);
  }
}

function initialWorkflowStageName(definition: ReturnType<typeof parsePlaybookDefinition>): string | null {
  if (definition.lifecycle === 'ongoing') {
    return null;
  }
  return defaultStageName(definition);
}

function sanitizeCreatedWorkflow(workflow: CreatedWorkflow): CreatedWorkflow {
  if (workflow.lifecycle !== 'ongoing') {
    return workflow;
  }

  const { current_stage: _currentStage, ...rest } = workflow;
  return rest as CreatedWorkflow;
}
