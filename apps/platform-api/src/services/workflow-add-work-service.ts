import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool, DatabaseQueryable } from '../db/database.js';
import { NotFoundError, ValidationError } from '../errors/domain-errors.js';
import type { WorkflowActivationDispatchService } from './workflow-activation-dispatch/workflow-activation-dispatch-service.js';
import type { WorkflowActivationService } from './workflow-activation/workflow-activation-service.js';
import type { WorkItemService } from './work-item-service/work-item-service.js';
import type { CreateWorkItemInput, WorkItemReadModel } from './work-item-service/types.js';
import type { WorkflowInputPacketService } from './workflow-input-packet-service.js';
import type { WorkflowOperatorFileUploadInput } from './workflow-operator/workflow-operator-file-support.js';

interface WorkflowLifecycleRow {
  lifecycle: string | null;
}

export interface CreateWorkflowWorkInitialInputPacketInput {
  summary?: string;
  structured_inputs?: Record<string, unknown>;
  files?: WorkflowOperatorFileUploadInput[];
}

export interface CreateWorkflowWorkItemEnvelopeInput extends CreateWorkItemInput {
  initial_input_packet?: CreateWorkflowWorkInitialInputPacketInput;
}

interface CreateWorkItemOptions {
  dispatchActivation?: boolean;
}

interface WorkflowAddWorkDeps {
  pool: DatabasePool;
  workItemService: Pick<WorkItemService, 'createWorkItem'>;
  activationService: Pick<WorkflowActivationService, 'enqueueForWorkflow'>;
  activationDispatchService: Pick<WorkflowActivationDispatchService, 'dispatchActivation'>;
  inputPacketService?: Pick<WorkflowInputPacketService, 'createWorkflowInputPacket'>;
}

export class WorkflowAddWorkService {
  constructor(private readonly deps: WorkflowAddWorkDeps) {}

  async createWorkItem(
    identity: ApiKeyIdentity,
    workflowId: string,
    input: CreateWorkflowWorkItemEnvelopeInput,
    client?: DatabaseClient,
  ): Promise<WorkItemReadModel> {
    const initialPacket = input.initial_input_packet;
    if (!hasInitialPacketContent(initialPacket)) {
      return this.deps.workItemService.createWorkItem(identity, workflowId, stripInitialPacket(input), client);
    }
    if (!this.deps.inputPacketService) {
      throw new ValidationError('Workflow input packets are not configured for operator add-work.');
    }

    const ownsClient = !client;
    const db = client ?? await this.deps.pool.connect();
    try {
      if (ownsClient) {
        await db.query('BEGIN');
      }

      const lifecycle = await readWorkflowLifecycle(db, identity.tenantId, workflowId);
      const workItem = await this.deps.workItemService.createWorkItem(
        identity,
        workflowId,
        stripInitialPacket(input),
        db,
        { dispatchActivation: false },
      );

      await this.deps.inputPacketService.createWorkflowInputPacket(
        identity,
        workflowId,
        {
          requestId: input.request_id,
          packetKind: resolvePacketKind(lifecycle),
          source: 'operator',
          createdByKind: 'operator',
          summary: initialPacket?.summary,
          structuredInputs: initialPacket?.structured_inputs,
          workItemId: workItem.id,
          files: initialPacket?.files ?? [],
        },
        db,
      );

      const activation = await this.deps.activationService.enqueueForWorkflow(
        {
          tenantId: identity.tenantId,
          workflowId,
          requestId: input.request_id ? `work-item:${input.request_id}` : undefined,
          reason: 'work_item.created',
          eventType: 'work_item.created',
          payload: {
            work_item_id: workItem.id,
            stage_name: workItem.stage_name,
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

      if (ownsClient) {
        await db.query('COMMIT');
      }
      return workItem;
    } catch (error) {
      if (ownsClient) {
        await db.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (ownsClient) {
        db.release();
      }
    }
  }
}

function hasInitialPacketContent(
  packet: CreateWorkflowWorkInitialInputPacketInput | undefined,
): boolean {
  if (!packet) {
    return false;
  }
  if (typeof packet.summary === 'string' && packet.summary.trim().length > 0) {
    return true;
  }
  if (Array.isArray(packet.files) && packet.files.length > 0) {
    return true;
  }
  return hasStructuredInputs(packet.structured_inputs);
}

function hasStructuredInputs(value: Record<string, unknown> | undefined): boolean {
  if (!value) {
    return false;
  }
  return Object.keys(value).length > 0;
}

function stripInitialPacket(
  input: CreateWorkflowWorkItemEnvelopeInput,
): CreateWorkItemInput {
  const { initial_input_packet: _initialPacket, ...workItemInput } = input;
  return workItemInput;
}

async function readWorkflowLifecycle(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
): Promise<string | null> {
  const result = await db.query<WorkflowLifecycleRow>(
    `SELECT lifecycle
       FROM workflows
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workflowId],
  );
  if (!result.rowCount) {
    throw new NotFoundError('Workflow not found');
  }
  return result.rows[0]?.lifecycle ?? null;
}

function resolvePacketKind(lifecycle: string | null): string {
  return lifecycle === 'ongoing' ? 'intake' : 'plan_update';
}
