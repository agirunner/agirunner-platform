import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabasePool } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type {
  CreateWorkflowInput,
  WorkflowAttemptInput,
} from './workflow-service.types.js';
import type {
  CreateWorkflowInputPacketInput,
  WorkflowInputPacketRecord,
  WorkflowInputPacketService,
} from './workflow-input-packet-service.js';
import type { EventService } from './event-service.js';
import type { WorkflowService } from './workflow-service.js';

interface SourceWorkflowRow {
  id: string;
  workspace_id: string | null;
  playbook_id: string | null;
  name: string;
  parameters: Record<string, string> | null;
  context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  root_workflow_id: string | null;
  previous_attempt_workflow_id: string | null;
  attempt_number: number | null;
  attempt_kind: string | null;
  live_visibility_mode_override: 'standard' | 'enhanced' | null;
}

interface WorkflowAttemptRecord extends WorkflowAttemptInput {
  root_workflow_id: string;
  previous_attempt_workflow_id: string;
  attempt_number: number;
  attempt_kind: 'redrive';
}

export interface RedriveWorkflowInput {
  requestId?: string;
  name?: string;
  summary?: string;
  steeringInstruction?: string;
  parameters?: Record<string, string>;
  structuredInputs?: Record<string, unknown>;
  liveVisibilityMode?: 'standard' | 'enhanced';
  files?: CreateWorkflowInputPacketInput['files'];
}

export interface RedriveWorkflowResult {
  source_workflow_id: string;
  attempt_number: number;
  workflow: Record<string, unknown>;
  input_packet: WorkflowInputPacketRecord | null;
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

    const attempt = buildWorkflowAttempt(sourceWorkflow);
    const workflow = await this.workflowService.createWorkflow(
      identity,
      buildWorkflowCreateInput(sourceWorkflow, attempt, input),
    );
    const inputPacket = await this.createRedrivePacket(identity, workflow.id as string, attempt, input, sourceWorkflowId);

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
    };
  }

  private async createRedrivePacket(
    identity: ApiKeyIdentity,
    workflowId: string,
    attempt: WorkflowAttemptInput,
    input: RedriveWorkflowInput,
    sourceWorkflowId: string,
  ): Promise<WorkflowInputPacketRecord | null> {
    const summary = sanitizeOptionalText(input.summary);
    const structuredInputs = asRecord(input.structuredInputs);
    const files = input.files ?? [];
    if (!summary && Object.keys(structuredInputs).length === 0 && files.length === 0) {
      return null;
    }

    return this.inputPacketService.createWorkflowInputPacket(identity, workflowId, {
      packetKind: 'redrive',
      source: 'redrive',
      summary: summary ?? undefined,
      structuredInputs,
      metadata: {
        source_workflow_id: sourceWorkflowId,
        attempt_number: attempt.attempt_number,
        steering_instruction: sanitizeOptionalText(input.steeringInstruction),
      },
      files,
    });
  }

  private async loadSourceWorkflow(tenantId: string, workflowId: string): Promise<SourceWorkflowRow> {
    const result = await this.pool.query<SourceWorkflowRow>(
      `SELECT id,
              workspace_id,
              playbook_id,
              name,
              parameters,
              context,
              metadata,
              root_workflow_id,
              previous_attempt_workflow_id,
              attempt_number,
              attempt_kind,
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
): CreateWorkflowInput {
  const summary = sanitizeOptionalText(input.summary);
  const steeringInstruction = sanitizeOptionalText(input.steeringInstruction);

  return {
    playbook_id: sourceWorkflow.playbook_id as string,
    workspace_id: sourceWorkflow.workspace_id ?? undefined,
    name: sanitizeOptionalText(input.name) ?? `${sourceWorkflow.name} redrive`,
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
        ...(steeringInstruction ? { steering_instruction: steeringInstruction } : {}),
      },
    },
    metadata: {
      ...inheritWorkflowMetadata(sourceWorkflow.metadata),
      redrive_source_workflow_id: sourceWorkflow.id,
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
