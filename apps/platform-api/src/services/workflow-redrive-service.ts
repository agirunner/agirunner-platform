import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type {
  CreateWorkflowInput,
  WorkflowAttemptInput,
} from './workflow-service/workflow-service.types.js';
import type {
  CreateWorkflowInputPacketInput,
  WorkflowInputPacketRecord,
  WorkflowInputPacketService,
} from './workflow-input-packet-service.js';
import type { EventService } from './event/event-service.js';
import type { WorkflowService } from './workflow-service/workflow-service.js';

interface SourceWorkflowRow {
  id: string;
  state: string;
  workspace_id: string | null;
  playbook_id: string | null;
  name: string;
  parameters: Record<string, string> | null;
  context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  attempt_group_id: string | null;
  root_workflow_id: string | null;
  previous_attempt_workflow_id: string | null;
  attempt_number: number | null;
  attempt_kind: string | null;
  redrive_reason: string | null;
  redrive_input_packet_id: string | null;
  inherited_input_packet_ids_json: unknown;
  live_visibility_mode_override: 'standard' | 'enhanced' | null;
}

interface WorkflowAttemptRecord extends WorkflowAttemptInput {
  attempt_group_id: string;
  root_workflow_id: string;
  previous_attempt_workflow_id: string;
  attempt_number: number;
  attempt_kind: 'redrive';
}

export interface RedriveWorkflowInput {
  requestId?: string;
  name?: string;
  reason?: string;
  summary?: string;
  steeringInstruction?: string;
  parameters?: Record<string, string>;
  structuredInputs?: Record<string, unknown>;
  redriveInputPacketId?: string;
  inheritancePolicy?: 'inherit_all' | 'inherit_none';
  liveVisibilityMode?: 'standard' | 'enhanced';
  files?: CreateWorkflowInputPacketInput['files'];
}

export interface RedriveWorkflowResult {
  source_workflow_id: string;
  attempt_number: number;
  workflow: Record<string, unknown>;
  input_packet: WorkflowInputPacketRecord | null;
  redrive_lineage: {
    attempt_group_id: string;
    attempt_number: number;
    source_workflow_id: string;
    redrive_reason: string | null;
    redrive_input_packet_id: string | null;
    inherited_input_packet_ids: string[];
  };
}

export class WorkflowRedriveService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly workflowService: Pick<WorkflowService, 'createWorkflow'>,
    private readonly inputPacketService: Pick<WorkflowInputPacketService, 'createWorkflowInputPacket'>,
    private readonly eventService: Pick<EventService, 'emit'>,
  ) {}

  async redriveWorkflow(
    identity: ApiKeyIdentity,
    sourceWorkflowId: string,
    input: RedriveWorkflowInput,
  ): Promise<RedriveWorkflowResult> {
    const sourceWorkflow = await this.loadSourceWorkflow(identity.tenantId, sourceWorkflowId);
    if (!sourceWorkflow.playbook_id) {
      throw new ValidationError('Workflow redrive requires a playbook workflow.');
    }
    if (!isTerminalWorkflowState(sourceWorkflow.state)) {
      throw new ValidationError('Workflow redrive requires a terminal workflow state.');
    }

    const attempt = buildWorkflowAttempt(sourceWorkflow);
    const inheritedInputPacketIds = resolveInheritedInputPacketIds(sourceWorkflow, input);
    const workflow = await this.workflowService.createWorkflow(
      identity,
      buildWorkflowCreateInput(sourceWorkflow, attempt, input, inheritedInputPacketIds),
    );
    const inputPacket = await this.createRedrivePacket(
      identity,
      workflow.id as string,
      attempt,
      input,
      sourceWorkflowId,
      inheritedInputPacketIds,
    );

    await this.eventService.emit({
      tenantId: identity.tenantId,
      type: 'workflow.redriven',
      entityType: 'workflow',
      entityId: String(workflow.id),
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: {
        source_workflow_id: sourceWorkflowId,
        attempt_number: attempt.attempt_number,
      },
    });

    return {
      source_workflow_id: sourceWorkflowId,
      attempt_number: attempt.attempt_number,
      workflow,
      input_packet: inputPacket,
      redrive_lineage: {
        attempt_group_id: attempt.attempt_group_id,
        attempt_number: attempt.attempt_number,
        source_workflow_id: sourceWorkflowId,
        redrive_reason: sanitizeOptionalText(input.reason),
        redrive_input_packet_id: sanitizeOptionalText(input.redriveInputPacketId),
        inherited_input_packet_ids: inheritedInputPacketIds,
      },
    };
  }

  private async createRedrivePacket(
    identity: ApiKeyIdentity,
    workflowId: string,
    attempt: WorkflowAttemptInput,
    input: RedriveWorkflowInput,
    sourceWorkflowId: string,
    inheritedInputPacketIds: string[],
  ): Promise<WorkflowInputPacketRecord | null> {
    const summary = sanitizeOptionalText(input.summary);
    const structuredInputs = asRecord(input.structuredInputs);
    const files = input.files ?? [];
    if (!summary && Object.keys(structuredInputs).length === 0 && files.length === 0) {
      return null;
    }

    return this.inputPacketService.createWorkflowInputPacket(identity, workflowId, {
      requestId: sanitizeOptionalText(input.requestId) ?? undefined,
      packetKind: 'redrive_patch',
      source: 'redrive',
      sourceAttemptId: sourceWorkflowId,
      summary: summary ?? undefined,
      structuredInputs,
      metadata: {
        source_workflow_id: sourceWorkflowId,
        attempt_number: attempt.attempt_number,
        redrive_reason: sanitizeOptionalText(input.reason),
        redrive_input_packet_id: sanitizeOptionalText(input.redriveInputPacketId),
        inherited_input_packet_ids: inheritedInputPacketIds,
        inheritance_policy: input.inheritancePolicy ?? 'inherit_all',
        steering_instruction: sanitizeOptionalText(input.steeringInstruction),
      },
      files,
    });
  }

  private async loadSourceWorkflow(tenantId: string, workflowId: string): Promise<SourceWorkflowRow> {
    const result = await this.pool.query<SourceWorkflowRow>(
      `SELECT id,
              state,
              workspace_id,
              playbook_id,
              name,
              parameters,
              context,
              metadata,
              attempt_group_id,
              root_workflow_id,
              previous_attempt_workflow_id,
              attempt_number,
              attempt_kind,
              redrive_reason,
              redrive_input_packet_id,
              inherited_input_packet_ids_json,
              live_visibility_mode_override
         FROM workflows
        WHERE tenant_id = $1
          AND id = $2`,
      [tenantId, workflowId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Workflow not found');
    }
    return row;
  }
}

function buildWorkflowAttempt(sourceWorkflow: SourceWorkflowRow): WorkflowAttemptRecord {
  return {
    attempt_group_id: sourceWorkflow.attempt_group_id ?? sourceWorkflow.root_workflow_id ?? sourceWorkflow.id,
    root_workflow_id: sourceWorkflow.root_workflow_id ?? sourceWorkflow.id,
    previous_attempt_workflow_id: sourceWorkflow.id,
    attempt_number: (sourceWorkflow.attempt_number ?? 1) + 1,
    attempt_kind: 'redrive',
  };
}

function buildWorkflowCreateInput(
  sourceWorkflow: SourceWorkflowRow,
  attempt: WorkflowAttemptInput,
  input: RedriveWorkflowInput,
  inheritedInputPacketIds: string[],
): CreateWorkflowInput {
  const summary = sanitizeOptionalText(input.summary);
  const steeringInstruction = sanitizeOptionalText(input.steeringInstruction);
  const reason = sanitizeOptionalText(input.reason);
  const redriveInputPacketId = sanitizeOptionalText(input.redriveInputPacketId);
  const inheritancePolicy = input.inheritancePolicy ?? 'inherit_all';

  return {
    playbook_id: sourceWorkflow.playbook_id as string,
    workspace_id: sourceWorkflow.workspace_id ?? undefined,
    name: sanitizeOptionalText(input.name) ?? `${sourceWorkflow.name} redrive`,
    request_id: sanitizeOptionalText(input.requestId) ?? undefined,
    redrive_reason: reason ?? undefined,
    redrive_input_packet_id: redriveInputPacketId ?? undefined,
    inherited_input_packet_ids: inheritedInputPacketIds,
    inheritance_policy: inheritancePolicy,
    parameters: {
      ...asStringRecord(sourceWorkflow.parameters),
      ...asStringRecord(input.parameters),
    },
    context: {
      ...asRecord(sourceWorkflow.context),
      redrive: {
        source_workflow_id: sourceWorkflow.id,
        attempt_number: attempt.attempt_number,
        ...(summary ? { summary } : {}),
        ...(reason ? { reason } : {}),
        ...(steeringInstruction ? { steering_instruction: steeringInstruction } : {}),
      },
    },
    metadata: {
      ...inheritWorkflowMetadata(sourceWorkflow.metadata),
      redrive_source_workflow_id: sourceWorkflow.id,
      ...(reason ? { redrive_reason: reason } : {}),
      ...(redriveInputPacketId ? { redrive_input_packet_id: redriveInputPacketId } : {}),
      ...(inheritedInputPacketIds.length > 0 ? { inherited_input_packet_ids: inheritedInputPacketIds } : {}),
      inheritance_policy: inheritancePolicy,
      ...(input.requestId?.trim() ? { redrive_request_id: input.requestId.trim() } : {}),
    },
    attempt,
    live_visibility_mode: input.liveVisibilityMode ?? sourceWorkflow.live_visibility_mode_override ?? undefined,
  };
}

function inheritWorkflowMetadata(value: Record<string, unknown> | null): Record<string, unknown> {
  const metadata = { ...asRecord(value) };
  delete metadata.child_workflow_ids;
  delete metadata.latest_child_workflow_id;
  delete metadata.parent_workflow_id;
  delete metadata.chain_origin;
  delete metadata.create_request_id;
  delete metadata.redrive_request_id;
  delete metadata.redrive_source_workflow_id;
  return metadata;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter(([, entry]) => typeof entry === 'string' && entry.trim().length > 0),
  ) as Record<string, string>;
}

function sanitizeOptionalText(value?: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveInheritedInputPacketIds(sourceWorkflow: SourceWorkflowRow, input: RedriveWorkflowInput): string[] {
  if (input.inheritancePolicy === 'inherit_none') {
    return [];
  }
  if (!Array.isArray(sourceWorkflow.inherited_input_packet_ids_json)) {
    return [];
  }
  return sourceWorkflow.inherited_input_packet_ids_json.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
}

function isTerminalWorkflowState(value: string): boolean {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}
