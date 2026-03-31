import type { DatabaseClient, DatabasePool } from '../db/database.js';

import type { EventService } from './event/event-service.js';
import {
  enqueueWorkflowActivationRecord,
  isPlaybookWorkflow,
  type WorkflowActivationEventRow,
} from './workflow-activation/workflow-activation-record.js';

export interface ImmediateWorkflowActivationDispatcher {
  dispatchActivation(
    tenantId: string,
    activationId: string,
    existingClient?: DatabaseClient,
  ): Promise<string | null>;
}

interface ImmediateWorkflowActivationParams {
  tenantId: string;
  workflowId: string;
  requestId?: string;
  reason: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorType?: string;
  actorId?: string;
}

export async function enqueueAndDispatchImmediatePlaybookActivation(
  db: DatabaseClient | DatabasePool,
  eventService: EventService,
  dispatchService: ImmediateWorkflowActivationDispatcher | undefined,
  params: ImmediateWorkflowActivationParams,
): Promise<WorkflowActivationEventRow | null> {
  if (!(await isPlaybookWorkflow(db, params.tenantId, params.workflowId))) {
    return null;
  }

  return enqueueAndDispatchImmediateWorkflowActivation(
    db,
    eventService,
    dispatchService,
    params,
  );
}

export async function enqueueAndDispatchImmediateWorkflowActivation(
  db: DatabaseClient | DatabasePool,
  eventService: EventService,
  dispatchService: ImmediateWorkflowActivationDispatcher | undefined,
  params: ImmediateWorkflowActivationParams,
): Promise<WorkflowActivationEventRow> {
  const activation = await enqueueWorkflowActivationRecord(db, eventService, params);
  if (activation.state === 'queued') {
    await dispatchService?.dispatchActivation(
      params.tenantId,
      activation.id,
      'release' in db ? db : undefined,
    );
  }
  return activation;
}
