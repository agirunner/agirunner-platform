import type { MissionControlActionAvailability, MissionControlWorkflowCard } from './mission-control-types.js';
import type { WorkflowService } from '../workflow-service.js';
import type { WorkflowDeliverablesService } from './workflow-deliverables-service.js';
import type { WorkflowHistoryService } from './workflow-history-service.js';
import type { WorkflowLiveConsoleService } from './workflow-live-console-service.js';
import type { WorkflowRailService } from './workflow-rail-service.js';
import type {
  WorkflowInterventionRecord,
  WorkflowInterventionService,
} from '../workflow-intervention-service.js';
import type {
  WorkflowSteeringSessionRecord,
  WorkflowSteeringSessionService,
} from '../workflow-steering-session-service.js';
import type {
  WorkflowBottomTabsPacket,
  WorkflowNeedsActionItem,
  WorkflowWorkspacePacket,
} from './workflow-operations-types.js';

interface WorkflowWorkspaceQuery {
  boardMode?: string;
  boardFilters?: string;
  workItemId?: string;
  tabScope?: 'workflow' | 'selected_work_item';
  liveConsoleLimit?: number;
  historyLimit?: number;
  deliverablesLimit?: number;
  liveConsoleAfter?: string;
  historyAfter?: string;
  deliverablesAfter?: string;
}

export class WorkflowWorkspaceService {
  constructor(
    private readonly workflowService: Pick<WorkflowService, 'getWorkflow' | 'getWorkflowBoard'>,
    private readonly railService: Pick<WorkflowRailService, 'getWorkflowCard'>,
    private readonly liveConsoleService: Pick<WorkflowLiveConsoleService, 'getLiveConsole'>,
    private readonly historyService: Pick<WorkflowHistoryService, 'getHistory'>,
    private readonly deliverablesService: Pick<WorkflowDeliverablesService, 'getDeliverables'>,
    private readonly interventionService: Pick<WorkflowInterventionService, 'listWorkflowInterventions'>,
    private readonly steeringSessionService: Pick<
      WorkflowSteeringSessionService,
      'listSessions' | 'listMessages'
    >,
  ) {}

  async getWorkspace(
    tenantId: string,
    workflowId: string,
    input: WorkflowWorkspaceQuery = {},
  ): Promise<WorkflowWorkspacePacket> {
    const selectedScope = resolveSelectedScope(input);
    const scopedWorkItemId = selectedScope.scope_kind === 'selected_work_item'
      ? selectedScope.work_item_id
      : undefined;
    const [workflow, board, workflowCard, liveConsole, history, deliverables, interventions, sessions] =
      await Promise.all([
        this.workflowService.getWorkflow(tenantId, workflowId),
        this.workflowService.getWorkflowBoard(tenantId, workflowId),
        this.railService.getWorkflowCard(tenantId, workflowId),
        this.liveConsoleService.getLiveConsole(tenantId, workflowId, {
          limit: input.liveConsoleLimit,
          workItemId: scopedWorkItemId ?? undefined,
          after: input.liveConsoleAfter,
        }),
        this.historyService.getHistory(tenantId, workflowId, {
          limit: input.historyLimit,
          workItemId: scopedWorkItemId ?? undefined,
          after: input.historyAfter,
        }),
        this.deliverablesService.getDeliverables(tenantId, workflowId, {
          limit: input.deliverablesLimit,
          workItemId: scopedWorkItemId ?? undefined,
          after: input.deliverablesAfter,
        }),
        this.interventionService.listWorkflowInterventions(tenantId, workflowId),
        this.steeringSessionService.listSessions(tenantId, workflowId),
      ]);

    const needsActionItems = buildNeedsActionItems(
      workflowId,
      workflowCard?.availableActions ?? [],
      interventions,
      selectedScope.work_item_id,
    );
    const allDeliverables = deliverables.all_deliverables ?? [
      ...deliverables.final_deliverables,
      ...deliverables.in_progress_deliverables,
    ];
    const activeSession = sessions[0] ?? null;
    const sessionMessages = activeSession
      ? await this.steeringSessionService.listMessages(tenantId, workflowId, activeSession.id)
      : [];
    const bottomTabs = buildBottomTabs(
      needsActionItems.length,
      activeSession ? 1 : 0,
      liveConsole.items.length,
      history.items.length,
      allDeliverables.length,
      input,
    );

    return {
      workflow_id: workflowId,
      generated_at: history.generated_at,
      latest_event_id: history.latest_event_id,
      snapshot_version: history.snapshot_version,
      selected_scope: selectedScope,
      sticky_strip: workflowCard ? buildStickyStrip(workflowCard) : null,
      board: board as Record<string, unknown>,
      bottom_tabs: bottomTabs,
      needs_action: {
        items: needsActionItems,
        total_count: needsActionItems.length,
        default_sort: 'priority_desc',
      },
      steering: {
        quick_actions: workflowCard?.availableActions ?? [],
        decision_actions: [],
        steering_state: {
          mode: selectedScope.scope_kind === 'selected_work_item' ? 'selected_work_item' : 'workflow_scoped',
          can_accept_request: true,
          active_session_id: activeSession ? String(activeSession.id) : null,
          last_summary: workflowCard?.pulse.summary ?? null,
        },
        recent_interventions: interventions.slice(0, 10),
        session: {
          session_id: activeSession ? String(activeSession.id) : null,
          status: readSessionStatus(activeSession),
          messages: sessionMessages,
        },
      },
      live_console: liveConsole,
      history,
      deliverables,
      redrive_lineage: readRedriveLineage(workflow),
    };
  }
}

function resolveSelectedScope(input: WorkflowWorkspaceQuery): WorkflowWorkspacePacket['selected_scope'] {
  if (input.tabScope === 'selected_work_item' && input.workItemId) {
    return {
      scope_kind: 'selected_work_item',
      work_item_id: input.workItemId,
    };
  }
  return {
    scope_kind: 'workflow',
    work_item_id: null,
  };
}

function buildStickyStrip(workflowCard: MissionControlWorkflowCard) {
  return {
    workflow_id: workflowCard.id,
    workflow_name: workflowCard.name,
    posture: workflowCard.posture,
    summary: workflowCard.pulse.summary,
    approvals_count: workflowCard.metrics.waitingForDecisionCount,
    escalations_count: workflowCard.metrics.openEscalationCount,
    blocked_work_item_count: workflowCard.metrics.blockedWorkItemCount,
    active_task_count: workflowCard.metrics.activeTaskCount,
    active_work_item_count: workflowCard.metrics.activeWorkItemCount,
    steering_available: workflowCard.availableActions.some((action) => action.enabled),
  };
}

function buildBottomTabs(
  needsActionCount: number,
  steeringCount: number,
  liveConsoleCount: number,
  historyCount: number,
  deliverablesCount: number,
  input: WorkflowWorkspaceQuery,
): WorkflowBottomTabsPacket {
  return {
    default_tab: needsActionCount > 0 ? 'needs_action' : 'live_console',
    current_scope_kind: input.tabScope === 'selected_work_item' && input.workItemId ? 'selected_work_item' : 'workflow',
    current_work_item_id:
      input.tabScope === 'selected_work_item' ? input.workItemId ?? null : null,
    counts: {
      needs_action: needsActionCount,
      steering: steeringCount,
      live_console_activity: liveConsoleCount,
      history: historyCount,
      deliverables: deliverablesCount,
    },
  };
}

function buildNeedsActionItems(
  workflowId: string,
  actions: MissionControlActionAvailability[],
  interventions: WorkflowInterventionRecord[],
  selectedWorkItemId: string | null,
): WorkflowNeedsActionItem[] {
  const items: WorkflowNeedsActionItem[] = actions
    .filter((action) => action.enabled)
    .map((action): WorkflowNeedsActionItem => ({
      action_id: `${workflowId}:${action.kind}`,
      action_kind: action.kind,
      label: humanizeActionKind(action.kind),
      summary: action.disabledReason ?? humanizeActionKind(action.kind),
      target: resolveActionTarget(action.scope, workflowId, interventions, selectedWorkItemId),
      priority: action.scope === 'workflow' ? 'medium' : 'high',
      requires_confirmation: action.confirmationLevel !== 'immediate',
      submission: {
        route_kind: 'workflow_intervention',
        method: 'POST',
      },
    }));
  for (const intervention of interventions) {
    if (!isActionableIntervention(intervention)) {
      continue;
    }
    const actionKind = readStructuredActionKind(intervention) ?? intervention.kind;
    const target = readInterventionTarget(intervention, workflowId);
    const actionId = `${intervention.id}:${actionKind}:${target.target_id}`;
    if (items.some((item) => item.action_id === actionId)) {
      continue;
    }
    items.push({
      action_id: actionId,
      action_kind: actionKind,
      label: humanizeActionKind(actionKind),
      summary: intervention.summary,
      target,
      priority: 'high',
      requires_confirmation: false,
      submission: {
        route_kind: 'workflow_intervention',
        method: 'POST',
      },
    });
  }
  return items;
}

function humanizeActionKind(actionKind: string): string {
  return actionKind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function resolveActionTarget(
  scope: MissionControlActionAvailability['scope'],
  workflowId: string,
  interventions: WorkflowInterventionRecord[],
  selectedWorkItemId: string | null,
): WorkflowNeedsActionItem['target'] {
  if (scope === 'workflow') {
    return { target_kind: 'workflow', target_id: workflowId };
  }
  if (scope === 'work_item') {
    return {
      target_kind: 'work_item',
      target_id: selectedWorkItemId ?? readFirstInterventionId(interventions, 'work_item') ?? workflowId,
    };
  }
  return {
    target_kind: 'task',
    target_id: readFirstInterventionId(interventions, 'task') ?? workflowId,
  };
}

function readFirstInterventionId(
  interventions: WorkflowInterventionRecord[],
  targetKind: WorkflowNeedsActionItem['target']['target_kind'],
): string | null {
  for (const intervention of interventions) {
    const target = readInterventionTarget(intervention, intervention.workflow_id);
    if (target.target_kind === targetKind) {
      return target.target_id;
    }
  }
  return null;
}

function isActionableIntervention(intervention: WorkflowInterventionRecord): boolean {
  return intervention.status === 'open' || intervention.status === 'pending';
}

function readStructuredActionKind(intervention: WorkflowInterventionRecord): string | null {
  const value = intervention.structured_action?.kind;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInterventionTarget(
  intervention: WorkflowInterventionRecord,
  workflowId: string,
): WorkflowNeedsActionItem['target'] {
  if (typeof intervention.task_id === 'string' && intervention.task_id.trim().length > 0) {
    return {
      target_kind: 'task',
      target_id: intervention.task_id,
    };
  }
  if (typeof intervention.work_item_id === 'string' && intervention.work_item_id.trim().length > 0) {
    return {
      target_kind: 'work_item',
      target_id: intervention.work_item_id,
    };
  }
  return {
    target_kind: 'workflow',
    target_id: workflowId,
  };
}

function readSessionStatus(session: WorkflowSteeringSessionRecord | null): string {
  if (!session) {
    return 'idle';
  }
  return session.status.trim().length > 0 ? session.status : 'open';
}

function readRedriveLineage(workflow: Record<string, unknown>): Record<string, unknown> | null {
  const rootWorkflowId = readOptionalString(workflow.root_workflow_id);
  const previousAttemptWorkflowId = readOptionalString(workflow.previous_attempt_workflow_id);
  const attemptNumber = workflow.attempt_number;
  const attemptKind = readOptionalString(workflow.attempt_kind);
  if (!rootWorkflowId && !previousAttemptWorkflowId && attemptNumber == null && !attemptKind) {
    return null;
  }
  return {
    root_workflow_id: rootWorkflowId,
    previous_attempt_workflow_id: previousAttemptWorkflowId,
    attempt_number: attemptNumber ?? null,
    attempt_kind: attemptKind,
  };
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
