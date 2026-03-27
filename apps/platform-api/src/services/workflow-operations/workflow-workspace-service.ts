import type { MissionControlActionAvailability, MissionControlWorkflowCard } from './mission-control-types.js';
import type { WorkflowService } from '../workflow-service.js';
import type { WorkflowDeliverablesService } from './workflow-deliverables-service.js';
import type { WorkflowHistoryService } from './workflow-history-service.js';
import type { WorkflowLiveConsoleService } from './workflow-live-console-service.js';
import type { WorkflowRailService } from './workflow-rail-service.js';
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
  ) {}

  async getWorkspace(
    tenantId: string,
    workflowId: string,
    input: WorkflowWorkspaceQuery = {},
  ): Promise<WorkflowWorkspacePacket> {
    const [workflow, board, workflowCard, liveConsole, history, deliverables] = await Promise.all([
      this.workflowService.getWorkflow(tenantId, workflowId),
      this.workflowService.getWorkflowBoard(tenantId, workflowId),
      this.railService.getWorkflowCard(tenantId, workflowId),
      this.liveConsoleService.getLiveConsole(tenantId, workflowId, { limit: input.historyLimit }),
      this.historyService.getHistory(tenantId, workflowId, { limit: input.historyLimit }),
      this.deliverablesService.getDeliverables(tenantId, workflowId, {
        limit: input.deliverablesLimit,
      }),
    ]);

    const needsActionItems = buildNeedsActionItems(workflowId, workflowCard?.availableActions ?? []);
    const allDeliverables = deliverables.all_deliverables ?? [
      ...deliverables.final_deliverables,
      ...deliverables.in_progress_deliverables,
    ];
    const bottomTabs = buildBottomTabs(
      needsActionItems.length,
      liveConsole.items.length,
      history.items.length,
      allDeliverables.length,
      input,
    );
    const generatedAt = history.generated_at;
    const latestEventId = history.latest_event_id;
    const latestOutput = allDeliverables[0] ?? null;
    const legacyPackets = history.legacy_packets ?? [];

    return {
      workflow_id: workflowId,
      generated_at: generatedAt,
      latest_event_id: latestEventId,
      snapshot_version: history.snapshot_version,
      sticky_strip: workflowCard ? buildStickyStrip(workflowCard) : null,
      board: board as Record<string, unknown>,
      bottom_tabs: bottomTabs,
      needs_action: {
        items: needsActionItems,
      },
      steering_panel: {
        quick_actions: workflowCard?.availableActions ?? [],
        decision_actions: [],
        steering_state: {
          mode: 'workflow_scoped',
          can_accept_request: true,
          active_session_id: null,
          last_summary: workflowCard?.pulse.summary ?? null,
        },
        recent_interventions: [],
        session: {
          session_id: null,
          status: 'idle',
          messages: [],
        },
      },
      live_console: liveConsole,
      history_timeline: history,
      deliverables_panel: deliverables,
      redrive_lineage: null,
      workflow: workflowCard as unknown as Record<string, unknown> | null,
      overview: workflowCard
        ? {
            currentOperatorAsk: workflowCard.pulse.summary,
            latestOutput,
            inputSummary: {
              parameterCount: Object.keys(asRecord(workflow.parameters)).length,
              parameterKeys: Object.keys(asRecord(workflow.parameters)).slice(0, 10),
              contextKeys: Object.keys(asRecord(workflow.context)).slice(0, 10),
            },
            relationSummary: asRecord(workflow.workflow_relations),
            riskSummary: {
              blockedWorkItemCount: workflowCard.metrics.blockedWorkItemCount,
              openEscalationCount: workflowCard.metrics.openEscalationCount,
              failedTaskCount: workflowCard.metrics.failedTaskCount,
              recoverableIssueCount: workflowCard.metrics.recoverableIssueCount,
            },
          }
        : null,
      outputs: {
        deliverables: allDeliverables,
        feed: legacyPackets.filter((packet) => packet.category === 'output'),
      },
      steering: {
        availableActions: workflowCard?.availableActions ?? [],
        interventionHistory: legacyPackets.filter(
          (packet) => packet.category === 'decision' || packet.category === 'intervention',
        ),
      },
      history: {
        packets: legacyPackets,
      },
    };
  }
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
  liveConsoleCount: number,
  historyCount: number,
  deliverablesCount: number,
  input: WorkflowWorkspaceQuery,
): WorkflowBottomTabsPacket {
  return {
    default_tab: needsActionCount > 0 ? 'needs_action' : 'live_console',
    current_scope_kind: input.workItemId ? 'selected_work_item' : 'workflow',
    current_work_item_id: input.workItemId ?? null,
    counts: {
      needs_action: needsActionCount,
      steering: 0,
      live_console: liveConsoleCount,
      history: historyCount,
      deliverables: deliverablesCount,
    },
  };
}

function buildNeedsActionItems(
  workflowId: string,
  actions: MissionControlActionAvailability[],
): WorkflowNeedsActionItem[] {
  return actions
    .filter((action) => action.enabled)
    .map((action) => ({
      action_id: `${workflowId}:${action.kind}`,
      action_kind: action.kind,
      label: humanizeActionKind(action.kind),
      summary: action.disabledReason ?? humanizeActionKind(action.kind),
      target_kind: action.scope,
      target_id: workflowId,
      requires_confirmation: action.confirmationLevel !== 'immediate',
    }));
}

function humanizeActionKind(actionKind: string): string {
  return actionKind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
