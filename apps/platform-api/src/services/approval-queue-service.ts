import type { DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { loadGateResumeHistory } from './gate-resume-history.js';
import {
  toGateResponse,
  type WorkflowStageGateRecord,
} from './workflow-stage-gate-service.js';

interface ApprovalTaskRow {
  id: string;
  title: string;
  state: string;
  workflow_id: string | null;
  workflow_name: string | null;
  work_item_id: string | null;
  work_item_title: string | null;
  stage_name: string | null;
  role: string | null;
  activation_id: string | null;
  rework_count: number | null;
  created_at: Date;
  output: unknown;
}

interface ApprovalStageRow extends WorkflowStageGateRecord {
  workflow_id: string;
  workflow_name: string;
  stage_id: string;
  stage_name: string;
  stage_goal: string | null;
  status: string;
  request_summary: string | null;
  updated_at: Date;
  decision_history: unknown;
}

export class ApprovalQueueService {
  constructor(private readonly pool: DatabasePool) {}

  async listApprovals(tenantId: string) {
    const [tasks, stageGates] = await Promise.all([
      this.pool.query<ApprovalTaskRow>(
        `SELECT t.id,
                t.title,
                t.state,
                t.workflow_id,
                w.name AS workflow_name,
                t.work_item_id::text AS work_item_id,
                wi.title AS work_item_title,
                t.stage_name,
                t.role,
                t.activation_id::text AS activation_id,
                t.rework_count,
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
          WHERE t.tenant_id = $1
            AND t.state IN ('awaiting_approval', 'output_pending_review')
          ORDER BY t.created_at ASC`,
        [tenantId],
      ),
      this.pool.query<ApprovalStageRow>(
        `SELECT g.id,
                ws.workflow_id,
                w.name AS workflow_name,
                ws.id AS stage_id,
                ws.name AS stage_name,
                ws.goal AS stage_goal,
                g.status,
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
                history.decision_history
           FROM workflow_stage_gates g
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
           ) resume ON true
           LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                      jsonb_build_object(
                        'action',
                        CASE
                          WHEN e.type = 'stage.gate_requested' THEN 'requested'
                          WHEN e.type = 'stage.gate.approve' THEN 'approve'
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
                AND e.type = ANY($2::text[])
           ) history ON true
          WHERE g.tenant_id = $1
            AND g.status = 'awaiting_approval'
          ORDER BY g.requested_at ASC`,
        [tenantId, ['stage.gate_requested', 'stage.gate.approve', 'stage.gate.reject', 'stage.gate.request_changes']],
      ),
    ]);
    const stageGateRows = await this.attachGateResumeHistory(tenantId, stageGates.rows);

    return {
      task_approvals: tasks.rows.map((row) => ({
        id: row.id,
        title: row.title,
        state: row.state,
        workflow_id: row.workflow_id,
        workflow_name: row.workflow_name,
        work_item_id: row.work_item_id,
        work_item_title: row.work_item_title,
        stage_name: row.stage_name,
        role: row.role,
        activation_id: row.activation_id,
        rework_count: row.rework_count ?? 0,
        created_at: row.created_at.toISOString(),
        output: row.output,
      })),
      stage_gates: stageGateRows.map((row) => toGateResponse(row)),
    };
  }

  async listWorkflowGates(tenantId: string, workflowId: string) {
    const result = await this.pool.query<ApprovalStageRow>(
      `SELECT g.id,
              ws.workflow_id,
              w.name AS workflow_name,
              ws.id AS stage_id,
              ws.name AS stage_name,
              ws.goal AS stage_goal,
              g.status,
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
              history.decision_history
         FROM workflow_stage_gates g
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
         ) resume ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'action',
                      CASE
                        WHEN e.type = 'stage.gate_requested' THEN 'requested'
                        WHEN e.type = 'stage.gate.approve' THEN 'approve'
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
              AND e.type = ANY($3::text[])
         ) history ON true
        WHERE g.tenant_id = $1
          AND g.workflow_id = $2
        ORDER BY g.requested_at DESC`,
      [tenantId, workflowId, ['stage.gate_requested', 'stage.gate.approve', 'stage.gate.reject', 'stage.gate.request_changes']],
    );
    const rows = await this.attachGateResumeHistory(tenantId, result.rows, workflowId);
    return rows.map((row) => toGateResponse(row));
  }

  async getGate(tenantId: string, gateId: string, workflowId?: string) {
    const values: unknown[] = [tenantId, gateId];
    const historyEventsParameter = workflowId ? '$4' : '$3';
    const workflowClause = workflowId
      ? (() => {
          values.push(workflowId);
          return 'AND g.workflow_id = $3';
        })()
      : '';
    const result = await this.pool.query<ApprovalStageRow>(
      `SELECT g.id,
              ws.workflow_id,
              w.name AS workflow_name,
              ws.id AS stage_id,
              ws.name AS stage_name,
              ws.goal AS stage_goal,
              g.status,
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
              history.decision_history
         FROM workflow_stage_gates g
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
         ) resume ON true
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'action',
                      CASE
                        WHEN e.type = 'stage.gate_requested' THEN 'requested'
                        WHEN e.type = 'stage.gate.approve' THEN 'approve'
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
         ) history ON true
        WHERE g.tenant_id = $1
          AND g.id = $2
          ${workflowClause}
        LIMIT 1`,
      [
        ...values,
        ['stage.gate_requested', 'stage.gate.approve', 'stage.gate.reject', 'stage.gate.request_changes'],
      ],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Workflow stage gate not found');
    }
    const rows = await this.attachGateResumeHistory(
      tenantId,
      result.rows,
      workflowId ?? result.rows[0].workflow_id,
    );
    return toGateResponse(rows[0]);
  }

  private async attachGateResumeHistory(
    tenantId: string,
    rows: ApprovalStageRow[],
    workflowId?: string,
  ): Promise<ApprovalStageRow[]> {
    if (rows.length === 0) {
      return rows;
    }
    const resumeHistory = await loadGateResumeHistory(
      this.pool,
      tenantId,
      rows.map((row) => row.id),
      workflowId,
    );
    return rows.map((row) => ({
      ...row,
      resume_activation_history: resumeHistory.get(row.id) ?? [],
    }));
  }
}
