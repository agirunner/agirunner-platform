import type { DatabasePool } from '../../db/database.js';

import {
  PENDING_STAGE_GATE_EVENT_TYPES,
  STAGE_GATE_EVENT_TYPES,
} from './constants.js';
import type {
  ApprovalStageRow,
  ApprovalTaskRow,
} from './types.js';

const TASK_APPROVALS_SQL = `SELECT t.id,
        t.title,
        t.state,
        t.workflow_id,
        w.name AS workflow_name,
        t.work_item_id::text AS work_item_id,
        wi.title AS work_item_title,
        t.stage_name,
        wi.next_expected_actor,
        wi.next_expected_action,
        t.role,
        t.activation_id::text AS activation_id,
        t.rework_count,
        handoff_stats.handoff_count,
        latest_handoff.role AS latest_handoff_role,
        latest_handoff.stage_name AS latest_handoff_stage_name,
        latest_handoff.summary AS latest_handoff_summary,
        latest_handoff.completion AS latest_handoff_completion,
        latest_handoff.successor_context AS latest_handoff_successor_context,
        latest_handoff.created_at AS latest_handoff_created_at,
        t.created_at,
        t.output
   FROM tasks t
   LEFT JOIN workflows w
     ON w.tenant_id = t.tenant_id
    AND w.id = t.workflow_id
   LEFT JOIN workflow_work_items wi
     ON wi.tenant_id = t.tenant_id
    AND wi.workflow_id = t.workflow_id
    AND wi.id = t.work_item_id
   LEFT JOIN LATERAL (
     SELECT COUNT(*)::int AS handoff_count
       FROM task_handoffs th
      WHERE th.tenant_id = t.tenant_id
        AND th.workflow_id = t.workflow_id
        AND (
          (th.work_item_id IS NULL AND t.work_item_id IS NULL)
          OR th.work_item_id = t.work_item_id
        )
   ) handoff_stats ON true
   LEFT JOIN LATERAL (
     SELECT th.role,
            th.stage_name,
            th.summary,
            th.completion,
            th.successor_context,
            th.created_at
       FROM task_handoffs th
      WHERE th.tenant_id = t.tenant_id
        AND th.workflow_id = t.workflow_id
        AND (
          (th.work_item_id IS NULL AND t.work_item_id IS NULL)
          OR th.work_item_id = t.work_item_id
        )
      ORDER BY th.sequence DESC, th.created_at DESC
      LIMIT 1
   ) latest_handoff ON true
  WHERE t.tenant_id = $1
    AND t.state IN ('awaiting_approval', 'output_pending_assessment')
  ORDER BY t.created_at ASC`;

const GATE_SELECT_FIELDS = `SELECT g.id,
        ws.workflow_id,
        w.name AS workflow_name,
        ws.id AS stage_id,
        ws.name AS stage_name,
        ws.goal AS stage_goal,
        g.status,
        g.closure_effect,
        g.request_summary,
        g.recommendation,
        g.concerns,
        g.key_artifacts,
        g.requested_by_type,
        g.requested_by_id,
        g.requested_at,
        g.updated_at,
        g.decided_by_type,
        g.decided_by_id,
        g.decision_feedback,
        g.decided_at,
        g.superseded_at,
        g.superseded_by_revision,
        requested_task.id::text AS requested_by_task_id,
        requested_task.title AS requested_by_task_title,
        requested_task.role AS requested_by_task_role,
        requested_task.work_item_id::text AS requested_by_work_item_id,
        requested_work_item.title AS requested_by_work_item_title,
        resume.id::text AS resume_activation_id,
        resume.state AS resume_activation_state,
        resume.event_type AS resume_activation_event_type,
        resume.reason AS resume_activation_reason,
        resume.queued_at AS resume_activation_queued_at,
        resume.started_at AS resume_activation_started_at,
        resume.completed_at AS resume_activation_completed_at,
        resume.summary AS resume_activation_summary,
        resume.error AS resume_activation_error,
        history.decision_history`;

const GATE_SHARED_JOINS = `FROM workflow_stage_gates g
 JOIN workflow_stages ws
   ON ws.tenant_id = g.tenant_id
  AND ws.workflow_id = g.workflow_id
  AND ws.id = g.stage_id
 JOIN workflows w
   ON w.tenant_id = g.tenant_id
  AND w.id = g.workflow_id
 LEFT JOIN tasks requested_task
   ON requested_task.tenant_id = g.tenant_id
  AND requested_task.id::text = g.requested_by_id
 LEFT JOIN workflow_work_items requested_work_item
   ON requested_work_item.tenant_id = requested_task.tenant_id
  AND requested_work_item.workflow_id = requested_task.workflow_id
  AND requested_work_item.id = requested_task.work_item_id
 LEFT JOIN LATERAL (
   SELECT wa.id,
          wa.state,
          wa.event_type,
          wa.reason,
          wa.queued_at,
          wa.started_at,
          wa.completed_at,
          wa.summary,
          wa.error
     FROM workflow_activations wa
    WHERE wa.tenant_id = g.tenant_id
      AND wa.workflow_id = g.workflow_id
      AND wa.payload->>'gate_id' = g.id::text
    ORDER BY wa.queued_at DESC
    LIMIT 1
 ) resume ON true`;

function buildGateHistoryJoin(historyEventsParameter: string) {
  return `LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'action',
               CASE
                 WHEN e.type = 'stage.gate_requested' THEN 'requested'
                 WHEN e.type = 'stage.gate.approve' THEN 'approve'
                 WHEN e.type = 'stage.gate.block' THEN 'block'
                 WHEN e.type = 'stage.gate.reject' THEN 'reject'
                 WHEN e.type = 'stage.gate.request_changes' THEN 'request_changes'
                 ELSE e.type
               END,
               'actor_type',
               e.actor_type,
               'actor_id',
               e.actor_id,
               'feedback',
               e.data->>'feedback',
               'created_at',
               e.created_at
             )
             ORDER BY e.created_at ASC, e.id ASC
           ) AS decision_history
      FROM events e
     WHERE e.tenant_id = g.tenant_id
       AND e.entity_type = 'gate'
       AND e.entity_id = g.id
       AND e.type = ANY(${historyEventsParameter}::text[])
  ) history ON true`;
}

function buildGateSelectSql(whereClause: string, orderByClause: string, historyEventsParameter: string) {
  return `${GATE_SELECT_FIELDS}
 ${GATE_SHARED_JOINS}
 ${buildGateHistoryJoin(historyEventsParameter)}
 WHERE ${whereClause}
 ${orderByClause}`;
}

export async function queryPendingApprovals(pool: DatabasePool, tenantId: string) {
  const [tasks, stageGates] = await Promise.all([
    pool.query<ApprovalTaskRow>(TASK_APPROVALS_SQL, [tenantId]),
    pool.query<ApprovalStageRow>(
      buildGateSelectSql(
        `g.tenant_id = $1
   AND g.status = 'awaiting_approval'`,
        'ORDER BY g.requested_at ASC',
        '$2',
      ),
      [tenantId, [...PENDING_STAGE_GATE_EVENT_TYPES]],
    ),
  ]);

  return { tasks, stageGates };
}

export function queryWorkflowGates(pool: DatabasePool, tenantId: string, workflowId: string) {
  return pool.query<ApprovalStageRow>(
    buildGateSelectSql(
      `g.tenant_id = $1
   AND g.workflow_id = $2`,
      'ORDER BY g.requested_at DESC',
      '$3',
    ),
    [tenantId, workflowId, [...STAGE_GATE_EVENT_TYPES]],
  );
}

export function queryGate(
  pool: DatabasePool,
  tenantId: string,
  gateId: string,
  workflowId?: string,
) {
  const values: unknown[] = [tenantId, gateId];
  const historyEventsParameter = workflowId ? '$4' : '$3';
  const workflowClause = workflowId
    ? (() => {
        values.push(workflowId);
        return 'AND g.workflow_id = $3';
      })()
    : '';

  return pool.query<ApprovalStageRow>(
    `${buildGateSelectSql(
      `g.tenant_id = $1
   AND g.id = $2
   ${workflowClause}`,
      'LIMIT 1',
      historyEventsParameter,
    )}`,
    [...values, [...STAGE_GATE_EVENT_TYPES]],
  );
}
