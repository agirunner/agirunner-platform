import type { DatabasePool } from '../../db/database.js';
import { deriveWorkflowActionAvailability } from './mission-control-action-availability.js';
import { composeMissionControlOutputDescriptor } from './mission-control-output-descriptors.js';
import { deriveMissionControlPosture } from './mission-control-posture.js';
import type {
  MissionControlAttentionItem,
  MissionControlLiveResponse,
  MissionControlLiveSection,
  MissionControlOutputDescriptor,
  MissionControlReadModelVersion,
  MissionControlWorkflowCard,
} from './mission-control-types.js';

interface WorkflowRow {
  id: string;
  name: string;
  state: string;
  lifecycle: string | null;
  current_stage: string | null;
  metadata: Record<string, unknown> | null;
  workspace_id: string | null;
  workspace_name: string | null;
  playbook_id: string | null;
  playbook_name: string | null;
  parameters: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  updated_at: Date | string | null;
}

interface WorkflowSignalRow {
  workflow_id: string;
  waiting_for_decision_count: number;
  open_escalation_count: number;
  blocked_work_item_count: number;
  failed_task_count: number;
  active_task_count: number;
  active_work_item_count: number;
  pending_work_item_count: number;
  recoverable_issue_count: number;
}

interface ArtifactOutputRow {
  workflow_id: string;
  artifact_id: string;
  task_id: string;
  logical_path: string;
  content_type: string | null;
}

interface DocumentOutputRow {
  workflow_id: string;
  document_id: string;
  logical_name: string;
  title: string | null;
  source: 'repository' | 'artifact' | 'external';
  location: string;
  artifact_id: string | null;
}

export class MissionControlLiveService {
  constructor(private readonly pool: DatabasePool) {}

  async getLive(
    tenantId: string,
    input: { page?: number; perPage?: number } = {},
  ): Promise<MissionControlLiveResponse> {
    const version = await this.buildVersion(tenantId);
    const workflows = await this.listWorkflowCards(tenantId, {
      page: input.page ?? 1,
      perPage: input.perPage ?? 100,
      version,
    });
    return {
      version,
      sections: groupWorkflowSections(workflows),
      attentionItems: buildAttentionItems(workflows),
    };
  }

  async listWorkflowCards(
    tenantId: string,
    input: {
      workflowIds?: string[];
      page?: number;
      perPage?: number;
      version?: MissionControlReadModelVersion;
    } = {},
  ): Promise<MissionControlWorkflowCard[]> {
    const version = input.version ?? (await this.buildVersion(tenantId));
    const workflows = await this.loadWorkflowRows(tenantId, input);
    const workflowIds = workflows.map((workflow) => workflow.id);
    const [signals, outputs] = await Promise.all([
      this.loadWorkflowSignals(tenantId, workflowIds),
      this.listWorkflowOutputDescriptors(tenantId, workflowIds, 1),
    ]);

    return workflows.map((workflow) =>
      buildWorkflowCard(
        workflow,
        signals.get(workflow.id) ?? emptySignals(workflow.id),
        outputs.get(workflow.id) ?? [],
        version,
      ),
    );
  }

  async listWorkflowOutputDescriptors(
    tenantId: string,
    workflowIds: string[],
    limitPerWorkflow = 1,
  ): Promise<Map<string, MissionControlOutputDescriptor[]>> {
    const result = new Map<string, MissionControlOutputDescriptor[]>();
    if (workflowIds.length === 0) return result;

    const [artifactRows, documentRows] = await Promise.all([
      this.pool.query<ArtifactOutputRow>(
        `SELECT workflow_id, artifact_id, task_id, logical_path, content_type
           FROM (
             SELECT workflow_id,
                    id AS artifact_id,
                    task_id,
                    logical_path,
                    content_type,
                    ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY created_at DESC) AS rn
               FROM workflow_artifacts
              WHERE tenant_id = $1
                AND workflow_id = ANY($2::uuid[])
           ) ranked
          WHERE rn <= $3`,
        [tenantId, workflowIds, limitPerWorkflow],
      ),
      this.pool.query<DocumentOutputRow>(
        `SELECT workflow_id, document_id, logical_name, title, source, location, artifact_id
           FROM (
             SELECT workflow_id,
                    id AS document_id,
                    logical_name,
                    title,
                    source,
                    location,
                    artifact_id,
                    ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY created_at DESC) AS rn
               FROM workflow_documents
              WHERE tenant_id = $1
                AND workflow_id = ANY($2::uuid[])
           ) ranked
          WHERE rn <= $3`,
        [tenantId, workflowIds, limitPerWorkflow],
      ),
    ]);

    for (const row of artifactRows.rows) {
      pushOutput(result, row.workflow_id, composeMissionControlOutputDescriptor({
        kind: 'artifact',
        id: `artifact:${row.artifact_id}`,
        artifactId: row.artifact_id,
        taskId: row.task_id,
        logicalPath: row.logical_path,
        contentType: row.content_type,
        status: 'draft',
      }));
    }

    for (const row of documentRows.rows) {
      pushOutput(result, row.workflow_id, composeMissionControlOutputDescriptor({
        kind: 'workflow_document',
        id: `document:${row.document_id}`,
        workflowId: row.workflow_id,
        documentId: row.document_id,
        logicalName: row.logical_name,
        title: row.title,
        source: row.source,
        location: row.location,
        artifactId: row.artifact_id,
        status: 'approved',
      }));
    }

    return result;
  }

  async getLatestEventId(tenantId: string): Promise<number | null> {
    const result = await this.pool.query<{ latest_event_id: number | null }>(
      'SELECT MAX(id)::int AS latest_event_id FROM events WHERE tenant_id = $1',
      [tenantId],
    );
    return result.rows[0]?.latest_event_id ?? null;
  }

  private async buildVersion(tenantId: string): Promise<MissionControlReadModelVersion> {
    const latestEventId = await this.getLatestEventId(tenantId);
    return {
      generatedAt: new Date().toISOString(),
      latestEventId,
      token: latestEventId === null ? 'mission-control:empty' : `mission-control:${latestEventId}`,
    };
  }

  private async loadWorkflowRows(
    tenantId: string,
    input: { workflowIds?: string[]; page?: number; perPage?: number },
  ): Promise<WorkflowRow[]> {
    if (input.workflowIds && input.workflowIds.length > 0) {
      const result = await this.pool.query<WorkflowRow>(
        `SELECT w.id, w.name, w.state, w.lifecycle, w.current_stage, w.metadata, w.workspace_id,
                ws.name AS workspace_name, w.playbook_id, pb.name AS playbook_name,
                w.parameters, w.context, w.updated_at
           FROM workflows w
           LEFT JOIN workspaces ws ON ws.tenant_id = w.tenant_id AND ws.id = w.workspace_id
           LEFT JOIN playbooks pb ON pb.tenant_id = w.tenant_id AND pb.id = w.playbook_id
          WHERE w.tenant_id = $1
            AND w.id = ANY($2::uuid[])
          ORDER BY w.updated_at DESC`,
        [tenantId, input.workflowIds],
      );
      return result.rows;
    }

    const page = input.page ?? 1;
    const perPage = input.perPage ?? 100;
    const offset = (page - 1) * perPage;
    const result = await this.pool.query<WorkflowRow>(
      `SELECT w.id, w.name, w.state, w.lifecycle, w.current_stage, w.metadata, w.workspace_id,
              ws.name AS workspace_name, w.playbook_id, pb.name AS playbook_name,
              w.parameters, w.context, w.updated_at
         FROM workflows w
         LEFT JOIN workspaces ws ON ws.tenant_id = w.tenant_id AND ws.id = w.workspace_id
         LEFT JOIN playbooks pb ON pb.tenant_id = w.tenant_id AND pb.id = w.playbook_id
        WHERE w.tenant_id = $1
        ORDER BY w.updated_at DESC
        LIMIT $2 OFFSET $3`,
      [tenantId, perPage, offset],
    );
    return result.rows;
  }

  private async loadWorkflowSignals(
    tenantId: string,
    workflowIds: string[],
  ): Promise<Map<string, WorkflowSignalRow>> {
    if (workflowIds.length === 0) return new Map();
    const result = await this.pool.query<WorkflowSignalRow>(
      `SELECT w.id AS workflow_id,
              (
                COALESCE(task_summary.waiting_for_decision_count, 0)
                + COALESCE(stage_summary.waiting_for_decision_count, 0)
              )::int AS waiting_for_decision_count,
              COALESCE(work_item_summary.open_escalation_count, 0)::int AS open_escalation_count,
              (
                COALESCE(work_item_summary.blocked_work_item_count, 0)
                + COALESCE(stage_summary.blocked_stage_count, 0)
              )::int AS blocked_work_item_count,
              COALESCE(task_summary.failed_task_count, 0)::int AS failed_task_count,
              COALESCE(task_summary.active_task_count, 0)::int AS active_task_count,
              COALESCE(work_item_summary.active_work_item_count, 0)::int AS active_work_item_count,
              COALESCE(work_item_summary.pending_work_item_count, 0)::int AS pending_work_item_count,
              COALESCE(recovery_summary.recoverable_issue_count, 0)::int AS recoverable_issue_count
         FROM workflows w
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE state IN ('awaiting_approval', 'output_pending_assessment'))::int AS waiting_for_decision_count,
                  COUNT(*) FILTER (WHERE state = 'failed')::int AS failed_task_count,
                  COUNT(*) FILTER (WHERE state IN ('ready', 'claimed', 'in_progress', 'awaiting_approval', 'output_pending_assessment'))::int AS active_task_count
             FROM tasks
            WHERE tenant_id = w.tenant_id
              AND workflow_id = w.id
         ) task_summary ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE completed_at IS NULL AND escalation_status = 'open')::int AS open_escalation_count,
                  COUNT(*) FILTER (WHERE completed_at IS NULL AND blocked_state = 'blocked')::int AS blocked_work_item_count,
                  COUNT(*) FILTER (WHERE completed_at IS NULL)::int AS active_work_item_count,
                  COUNT(*) FILTER (WHERE completed_at IS NULL)::int AS pending_work_item_count
             FROM workflow_work_items
            WHERE tenant_id = w.tenant_id
              AND workflow_id = w.id
         ) work_item_summary ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (WHERE gate_status = 'awaiting_approval')::int AS waiting_for_decision_count,
                  COUNT(*) FILTER (
                    WHERE gate_status IN ('blocked', 'changes_requested', 'rejected')
                  )::int AS blocked_stage_count
             FROM workflow_stages
            WHERE tenant_id = w.tenant_id
              AND workflow_id = w.id
         ) stage_summary ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) FILTER (
                    WHERE type IN ('workflow.activation_requeued', 'workflow.activation_stale_detected')
                       OR COALESCE(data->>'mutation_outcome', '') = 'recoverable_not_applied'
                  )::int AS recoverable_issue_count
             FROM events
            WHERE tenant_id = w.tenant_id
              AND (entity_type = 'workflow' AND entity_id = w.id OR data->>'workflow_id' = w.id::text)
         ) recovery_summary ON true
        WHERE w.tenant_id = $1
          AND w.id = ANY($2::uuid[])`,
      [tenantId, workflowIds],
    );

    return new Map(result.rows.map((row) => [row.workflow_id, row]));
  }
}

function buildWorkflowCard(
  workflow: WorkflowRow,
  signals: WorkflowSignalRow,
  outputs: MissionControlOutputDescriptor[],
  version: MissionControlReadModelVersion,
): MissionControlWorkflowCard {
  const hasPauseRequest = hasWorkflowMarker(workflow.metadata, 'pause_requested_at');
  const hasCancelRequest = hasWorkflowMarker(workflow.metadata, 'cancel_requested_at');
  const posture = deriveMissionControlPosture({
    workflowState: workflow.state,
    hasPauseRequest,
    hasCancelRequest,
    waitingForDecisionCount: signals.waiting_for_decision_count,
    openEscalationCount: signals.open_escalation_count,
    blockedWorkItemCount: signals.blocked_work_item_count,
    failedTaskCount: signals.failed_task_count,
    recoverableIssueCount: signals.recoverable_issue_count,
    activeTaskCount: signals.active_task_count,
    activeWorkItemCount: signals.active_work_item_count,
    pendingWorkItemCount: signals.pending_work_item_count,
    recentOutputCount: outputs.length,
    currentActivitySummary: outputs[0] ? `${outputs[0].title} updated` : readActivitySummary(workflow, signals),
    waitingReason: signals.waiting_for_decision_count > 0 ? 'Waiting on operator decisions' : null,
    blockerReason: readBlockerReason(signals),
    updatedAt: toIsoString(workflow.updated_at),
  });

  return {
    id: workflow.id,
    name: workflow.name,
    state: workflow.state,
    lifecycle: workflow.lifecycle,
    currentStage: workflow.current_stage,
    workspaceId: workflow.workspace_id,
    workspaceName: workflow.workspace_name,
    playbookId: workflow.playbook_id,
    playbookName: workflow.playbook_name,
    posture: posture.posture,
    attentionLane: posture.attentionLane,
    pulse: posture.pulse,
    outputDescriptors: outputs,
    availableActions: deriveWorkflowActionAvailability({
      workflowState: workflow.state,
      posture: posture.posture,
      hasCancelRequest,
      version: {
        readModelEventId: version.latestEventId,
        latestEventId: version.latestEventId,
      },
    }),
    metrics: {
      activeTaskCount: signals.active_task_count,
      activeWorkItemCount: signals.active_work_item_count,
      blockedWorkItemCount: signals.blocked_work_item_count,
      openEscalationCount: signals.open_escalation_count,
      waitingForDecisionCount: signals.waiting_for_decision_count,
      failedTaskCount: signals.failed_task_count,
      recoverableIssueCount: signals.recoverable_issue_count,
      lastChangedAt: toIsoString(workflow.updated_at),
    },
    version,
  };
}

function groupWorkflowSections(workflows: MissionControlWorkflowCard[]): MissionControlLiveSection[] {
  return [
    buildSection('needs_action', 'Needs Action', workflows.filter((row) => row.posture === 'needs_decision')),
    buildSection('at_risk', 'At Risk', workflows.filter((row) => ['needs_intervention', 'recoverable_needs_steering', 'terminal_failed'].includes(row.posture))),
    buildSection('progressing', 'Progressing', workflows.filter((row) => row.posture === 'progressing')),
    buildSection('waiting', 'Waiting', workflows.filter((row) => row.posture === 'waiting_by_design' || row.posture === 'paused' || row.posture === 'cancelling')),
    buildSection('recently_changed', 'Recently Changed', workflows.filter((row) => row.posture === 'completed' || row.posture === 'cancelled')),
  ].filter((section) => section.count > 0);
}

function buildAttentionItems(workflows: MissionControlWorkflowCard[]): MissionControlAttentionItem[] {
  return workflows
    .filter((workflow) => workflow.attentionLane !== 'watchlist')
    .map((workflow) => ({
      id: `attention:${workflow.id}`,
      lane: workflow.attentionLane,
      title: workflow.posture === 'needs_decision' ? 'Decision required' : 'Operator attention required',
      workflowId: workflow.id,
      summary: workflow.pulse.summary,
    }));
}

function buildSection(
  id: MissionControlLiveSection['id'],
  title: string,
  workflows: MissionControlWorkflowCard[],
): MissionControlLiveSection {
  return { id, title, count: workflows.length, workflows };
}

function pushOutput(
  outputs: Map<string, MissionControlOutputDescriptor[]>,
  workflowId: string,
  descriptor: MissionControlOutputDescriptor,
): void {
  const current = outputs.get(workflowId) ?? [];
  current.push(descriptor);
  outputs.set(workflowId, current);
}

function emptySignals(workflowId: string): WorkflowSignalRow {
  return {
    workflow_id: workflowId,
    waiting_for_decision_count: 0,
    open_escalation_count: 0,
    blocked_work_item_count: 0,
    failed_task_count: 0,
    active_task_count: 0,
    active_work_item_count: 0,
    pending_work_item_count: 0,
    recoverable_issue_count: 0,
  };
}

function readActivitySummary(workflow: WorkflowRow, signals: WorkflowSignalRow): string | null {
  if (workflow.current_stage) return `Active work in ${workflow.current_stage}`;
  if (signals.active_task_count > 0) return `${signals.active_task_count} tasks in flight`;
  if (signals.active_work_item_count > 0) return `${signals.active_work_item_count} work items in flight`;
  return null;
}

function readBlockerReason(signals: WorkflowSignalRow): string | null {
  if (signals.open_escalation_count > 0) return `${signals.open_escalation_count} escalations are still open`;
  if (signals.blocked_work_item_count > 0) return `${signals.blocked_work_item_count} work items are blocked`;
  if (signals.failed_task_count > 0) return `${signals.failed_task_count} tasks have failed`;
  return null;
}

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function hasWorkflowMarker(metadata: Record<string, unknown> | null, key: string): boolean {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim().length > 0;
}
