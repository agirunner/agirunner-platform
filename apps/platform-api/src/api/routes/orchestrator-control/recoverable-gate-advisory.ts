import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ApiKeyIdentity } from '../../../auth/api-key.js';
import type { DatabaseClient } from '../../../db/database.js';
import {
  NotFoundError,
  ValidationError,
} from '../../../errors/domain-errors.js';
import {
  buildRecoverableMutationResult,
  type GuidedClosureStateSnapshot,
} from '../../../services/guided-closure/types.js';
import { logSafetynetTriggered } from '../../../services/safetynet/logging.js';
import {
  PLATFORM_CONTROL_PLANE_UNCONFIGURED_GATE_ADVISORY_ID,
  mustGetSafetynetEntry,
} from '../../../services/safetynet/registry.js';
import type { ActiveOrchestratorTaskScope } from '../../../services/task/task-agent-scope-service.js';

import { gateRequestSchema } from './schemas.js';

const UNCONFIGURED_GATE_ADVISORY_SAFETYNET = mustGetSafetynetEntry(
  PLATFORM_CONTROL_PLANE_UNCONFIGURED_GATE_ADVISORY_ID,
);

export async function buildUnconfiguredGateApprovalAdvisory(
  app: FastifyInstance,
  identity: ApiKeyIdentity,
  taskScope: ActiveOrchestratorTaskScope,
  stageName: string,
  input: z.infer<typeof gateRequestSchema>,
  client: DatabaseClient,
  error: unknown,
): Promise<Record<string, unknown> | null> {
  const reasonCode = classifyUnconfiguredGateApprovalReason(error);
  if (!reasonCode) {
    return null;
  }

  const message = error instanceof Error ? error.message : 'Approval stage is not configured';
  const stateSnapshot: GuidedClosureStateSnapshot = {
    workflow_id: taskScope.workflow_id,
    work_item_id: taskScope.work_item_id ?? null,
    task_id: taskScope.id,
    current_stage: taskScope.stage_name ?? null,
    active_blocking_controls: [],
    active_advisory_controls: [],
  };
  const recovery = buildRecoverableMutationResult({
    recovery_class: reasonCode,
    blocking: false,
    reason_code: reasonCode,
    state_snapshot: stateSnapshot,
    suggested_next_actions: [
      {
        action_code: 'continue_work',
        target_type: 'work_item',
        target_id: taskScope.work_item_id ?? taskScope.workflow_id,
        why: 'The stage has no configured blocking approval gate.',
        requires_orchestrator_judgment: false,
      },
      {
        action_code: 'record_callout',
        target_type: 'workflow',
        target_id: taskScope.workflow_id,
        why: 'Persist the advisory concern if the workflow closes without a separate approval.',
        requires_orchestrator_judgment: true,
      },
    ],
    suggested_target_ids: {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: taskScope.id,
    },
    callout_recommendations: [
      {
        code: reasonCode,
        summary: message,
      },
    ],
    closure_still_possible: true,
  });
  const advisory = {
    ...recovery,
    advisory: true,
    advisory_event_type: 'workflow.advisory_recorded',
    advisory_kind: 'approval_not_configured',
    advisory_recorded: true,
    blocking: false,
    configured: false,
    control_type: 'approval',
    message,
    reason_code: reasonCode,
    request_summary: input.summary.trim(),
    safetynet_behavior_id: UNCONFIGURED_GATE_ADVISORY_SAFETYNET.id,
    stage_name: stageName,
    status: 'ignored_not_configured',
    task_id: taskScope.id,
    work_item_id: taskScope.work_item_id ?? null,
    workflow_id: taskScope.workflow_id,
  } satisfies Record<string, unknown>;

  logSafetynetTriggered(
    UNCONFIGURED_GATE_ADVISORY_SAFETYNET,
    'recoverable gate approval advisory returned because the stage has no configured human gate',
    {
      workflow_id: taskScope.workflow_id,
      work_item_id: taskScope.work_item_id ?? null,
      task_id: taskScope.id,
      stage_name: stageName,
      reason_code: reasonCode,
    },
  );

  await app.eventService.emit(
    {
      tenantId: identity.tenantId,
      type: 'workflow.advisory_recorded',
      entityType: 'workflow',
      entityId: taskScope.workflow_id,
      actorType: identity.scope,
      actorId: identity.keyPrefix,
      data: advisory,
    },
    client,
  );

  return advisory;
}

function classifyUnconfiguredGateApprovalReason(error: unknown): string | null {
  if (error instanceof ValidationError && error.message.includes('does not require a human gate')) {
    return 'approval_not_configured';
  }
  if (error instanceof NotFoundError && error.message.includes('Workflow stage')) {
    return 'approval_not_configured';
  }
  return null;
}
