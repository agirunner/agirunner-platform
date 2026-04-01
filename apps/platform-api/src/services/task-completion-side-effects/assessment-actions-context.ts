import type { DatabaseClient } from '../../db/database.js';
import { parsePlaybookDefinition } from '../../orchestration/playbook-model.js';
import type { LogService } from '../../logging/execution/log-service.js';
import type { EventService } from '../event/event-service.js';

export interface AssessmentExplicitOutcomeContext {
  tenantId: string;
  workflowId: string;
  assessmentTaskId: string;
  assessmentWorkItemId: string;
  subjectTaskId: string | null;
  subjectWorkItemId: string;
  decisionState: 'blocked' | 'rejected';
  feedback: string;
  blockedColumnId?: string | null;
  resolutionSource: string;
  resolutionGate: string;
  explicitSubjectTaskId: string | null;
  eventService: EventService;
  logService?: LogService;
  completedTask: Record<string, unknown>;
}

export interface AssessmentEscalationContext extends AssessmentExplicitOutcomeContext {
  subjectRevision: number | null;
}

export interface AssessmentBranchTerminationContext extends AssessmentExplicitOutcomeContext {
  branchId: string;
}

export async function loadWorkflowDefinition(
  client: DatabaseClient,
  tenantId: string,
  workflowId: string,
) {
  const result = await client.query<{ definition: unknown }>(
    `SELECT p.definition
       FROM workflows w
       JOIN playbooks p
         ON p.tenant_id = w.tenant_id
        AND p.id = w.playbook_id
      WHERE w.tenant_id = $1
        AND w.id = $2
      LIMIT 1`,
    [tenantId, workflowId],
  );
  const definition = result.rows[0]?.definition;
  return definition ? parsePlaybookDefinition(definition) : null;
}
