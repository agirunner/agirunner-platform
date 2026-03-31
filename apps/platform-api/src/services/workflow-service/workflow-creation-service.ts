import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabasePool } from '../../db/database.js';
import { NotFoundError, ValidationError } from '../../errors/domain-errors.js';
import {
  defaultStageName,
  parsePlaybookDefinition,
  type PlaybookDefinition,
} from '../../orchestration/playbook-model.js';
import { resolveWorkflowConfig } from '../platform-config/config-hierarchy-service.js';
import { WorkflowActivationService } from '../workflow-activation/workflow-activation-service.js';
import { WorkflowActivationDispatchService } from '../workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import type { CreateWorkflowInput, WorkflowAttemptInput } from './workflow-service.types.js';
import { EventService } from '../event/event-service.js';
import { resolveOperatorRecordActorId } from '../operator-record-authorship.js';
import { sanitizeOptionalWorkflowLiveVisibilityMode } from '../workflow-operator/workflow-operator-record-sanitization.js';
import { currentStageNameFromStages, WorkflowStageService } from '../workflow-stage/workflow-stage-service.js';
import { WorkflowStateService } from '../workflow-state-service.js';
import { readWorkspaceSettingsExtras } from '../workspace/workspace-settings.js';
import type { WorkflowInputPacketService } from '../workflow-input-packet-service.js';

interface WorkflowCreationDeps {
  pool: DatabasePool;
  eventService: EventService;
  stateService: WorkflowStateService;
  activationService: WorkflowActivationService;
  activationDispatchService: WorkflowActivationDispatchService;
  stageService: WorkflowStageService;
  inputPacketService?: Pick<WorkflowInputPacketService, 'createWorkflowInputPacket'>;
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

const DEFAULT_WORKFLOW_CONTEXT_MAX_BYTES = 5 * 1024 * 1024;

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
      const workspaceConfig = await this.loadWorkspaceConfig(identity.tenantId, input.workspace_id ?? null, client);
      const resolvedConfig = resolveWorkflowConfig(
        playbook.definition as Record<string, unknown>,
        workspaceConfig,
        input.config_overrides ?? {},
      );
      const workflowParameters = validateWorkflowParameters(definition, input.parameters);
      const workflowContext = normalizeWorkflowContext(input.context);
      const workflowAttempt = normalizeWorkflowAttempt(input.attempt);
      const workflowLiveVisibility = normalizeWorkflowLiveVisibility(
        input.live_visibility_mode,
        resolveOperatorRecordActorId(identity),
      );
      const initialStageName = initialWorkflowStageName(definition);
      const workflowMetadata = buildWorkflowMetadata(input);
      const workflowResult = await client.query(
        `INSERT INTO workflows (
           tenant_id, workspace_id, playbook_id, playbook_version, name, state, lifecycle,
           current_stage, parameters, metadata, resolved_config, config_layers,
           instruction_config, token_budget, cost_cap_usd, max_duration_minutes, orchestration_state,
           live_visibility_mode_override, live_visibility_revision, live_visibility_updated_by_operator_id,
           context, context_size_bytes, attempt_group_id, root_workflow_id, previous_attempt_workflow_id,
           attempt_number, attempt_kind, redrive_reason, redrive_input_packet_id, inherited_input_packet_ids_json
         ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '{}'::jsonb, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28::jsonb)
         RETURNING *`,
        [
          identity.tenantId,
          input.workspace_id ?? null,
          playbook.id,
          playbook.version,
          input.name,
          definition.lifecycle,
          null,
          workflowParameters,
          workflowMetadata,
          resolvedConfig.resolved,
          resolvedConfig.layers,
          input.instruction_config ?? null,
          input.budget?.token_budget ?? null,
          input.budget?.cost_cap_usd ?? null,
          input.budget?.max_duration_minutes ?? null,
          workflowLiveVisibility.mode,
          workflowLiveVisibility.revision,
          workflowLiveVisibility.updatedByOperatorId,
          workflowContext,
          byteLengthJson(workflowContext),
          workflowAttempt.attempt_group_id,
          workflowAttempt.root_workflow_id,
          workflowAttempt.previous_attempt_workflow_id,
          workflowAttempt.attempt_number,
          workflowAttempt.attempt_kind,
          sanitizeOptionalText(input.redrive_reason),
          sanitizeOptionalIdentifier(input.redrive_input_packet_id),
          sanitizeIdentifierArray(input.inherited_input_packet_ids),
        ],
      );
      const workflow = workflowResult.rows[0] as PersistedWorkflowRow;
      const createdStages = await this.deps.stageService.createStages(
        identity.tenantId,
        workflow.id as string,
        definition,
        client,
      );
      await this.createLaunchInputPacket(identity, workflow.id as string, input, client);

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

  private async loadWorkspaceConfig(
    tenantId: string,
    workspaceId: string | null,
    client: { query: DatabasePool['query'] },
  ): Promise<Record<string, unknown>> {
    if (!workspaceId) {
      return {};
    }

    const result = await client.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM workspaces WHERE tenant_id = $1 AND id = $2',
      [tenantId, workspaceId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workspace not found');
    }
    return readWorkspaceSettingsExtras(result.rows[0].settings);
  }

  private async createLaunchInputPacket(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CreateWorkflowInput,
    client: { query: DatabasePool['query'] },
  ): Promise<void> {
    if (!this.deps.inputPacketService) {
      return;
    }

    const requestId = sanitizeOptionalIdentifier(input.request_id);
    const operatorNote = sanitizeOptionalText(input.operator_note);
    const initialPacket = input.initial_input_packet;
    const summary = sanitizeOptionalText(initialPacket?.summary) ?? operatorNote;
    const structuredInputs = sanitizeRecord(initialPacket?.structured_inputs);
    const files = initialPacket?.files ?? [];
    if (!requestId && !operatorNote && !summary && Object.keys(structuredInputs).length === 0 && files.length === 0) {
      return;
    }

    await this.deps.inputPacketService.createWorkflowInputPacket(
      identity,
      workflowId,
      {
        requestId: requestId ?? undefined,
        packetKind: 'launch',
        source: 'launch',
        createdByKind: 'operator',
        summary: summary ?? undefined,
        structuredInputs,
        metadata: operatorNote ? { operator_note: operatorNote } : {},
        files,
      },
      client as never,
    );
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

function validateWorkflowParameters(
  definition: PlaybookDefinition,
  parameters: Record<string, unknown> | undefined,
): Record<string, string> {
  const declaredParameters = definition.parameters ?? [];
  const submittedParameters = parameters ?? {};
  const allowedSlugs = new Set(declaredParameters.map((parameter) => parameter.slug));
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(submittedParameters)) {
    if (!allowedSlugs.has(key)) {
      throw new ValidationError(`Unknown playbook launch input '${key}'.`);
    }
    if (typeof value !== 'string') {
      throw new ValidationError(`Playbook launch input '${key}' must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    normalized[key] = trimmed;
  }

  for (const parameter of declaredParameters) {
    if (!parameter.required) {
      continue;
    }
    if (!normalized[parameter.slug]) {
      throw new ValidationError(`Missing required playbook launch input '${parameter.slug}'.`);
    }
  }

  return normalized;
}

function normalizeWorkflowContext(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value)) {
    return {};
  }

  const sizeBytes = byteLengthJson(value);
  if (sizeBytes > DEFAULT_WORKFLOW_CONTEXT_MAX_BYTES) {
    throw new ValidationError('Workflow context exceeds the maximum supported size.');
  }

  return value;
}

function normalizeWorkflowAttempt(value: WorkflowAttemptInput | undefined) {
  const attemptNumber = value?.attempt_number ?? 1;
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    throw new ValidationError('Workflow attempt_number must be a positive integer.');
  }

  const attemptKind = value?.attempt_kind?.trim() || 'initial';
  if (attemptKind !== 'initial' && attemptKind !== 'redrive') {
    throw new ValidationError('Workflow attempt_kind must be initial or redrive.');
  }

  return {
    attempt_group_id: sanitizeOptionalIdentifier(value?.attempt_group_id),
    root_workflow_id: sanitizeOptionalIdentifier(value?.root_workflow_id),
    previous_attempt_workflow_id: sanitizeOptionalIdentifier(value?.previous_attempt_workflow_id),
    attempt_number: attemptNumber,
    attempt_kind: attemptKind,
  };
}

function normalizeWorkflowLiveVisibility(value: CreateWorkflowInput['live_visibility_mode'], updatedByOperatorId: string) {
  const mode = sanitizeOptionalWorkflowLiveVisibilityMode(value);
  if (!mode) {
    return {
      mode: null,
      revision: 0,
      updatedByOperatorId: null,
    };
  }
  return {
    mode,
    revision: 1,
    updatedByOperatorId,
  };
}

function sanitizeOptionalIdentifier(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeOptionalText(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeRecord(value?: Record<string, unknown>): Record<string, unknown> {
  if (!value || Array.isArray(value)) {
    return {};
  }
  return value;
}

function sanitizeIdentifierArray(value?: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => sanitizeOptionalIdentifier(entry))
    .filter((entry): entry is string => entry !== null);
}

function buildWorkflowMetadata(input: CreateWorkflowInput): Record<string, unknown> {
  const metadata = sanitizeRecord(input.metadata);
  const requestId = sanitizeOptionalIdentifier(input.request_id);
  const operatorNote = sanitizeOptionalText(input.operator_note);
  const redriveReason = sanitizeOptionalText(input.redrive_reason);
  const redriveInputPacketId = sanitizeOptionalIdentifier(input.redrive_input_packet_id);
  const inheritedInputPacketIds = sanitizeIdentifierArray(input.inherited_input_packet_ids);
  const inheritancePolicy = sanitizeOptionalText(input.inheritance_policy);

  return {
    ...metadata,
    ...(requestId ? { create_request_id: requestId } : {}),
    ...(operatorNote ? { operator_note: operatorNote } : {}),
    ...(redriveReason ? { redrive_reason: redriveReason } : {}),
    ...(redriveInputPacketId ? { redrive_input_packet_id: redriveInputPacketId } : {}),
    ...(inheritedInputPacketIds.length > 0 ? { inherited_input_packet_ids: inheritedInputPacketIds } : {}),
    ...(inheritancePolicy ? { inheritance_policy: inheritancePolicy } : {}),
  };
}

function byteLengthJson(value: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
