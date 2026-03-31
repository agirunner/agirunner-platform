import type { WorkflowDeliverableRecord } from '../../workflow-deliverable-service.js';
import type {
  WorkflowNeedsActionItem,
  WorkflowWorkspacePacket,
} from '../workflow-operations-types.js';

export interface WorkflowWorkspaceQuery {
  boardMode?: string;
  boardFilters?: string;
  workItemId?: string;
  taskId?: string;
  tabScope?: 'workflow' | 'selected_work_item' | 'selected_task';
  liveConsoleLimit?: number;
  briefsLimit?: number;
  historyLimit?: number;
  deliverablesLimit?: number;
  liveConsoleAfter?: string;
  briefsAfter?: string;
  historyAfter?: string;
  deliverablesAfter?: string;
}

export interface ActionableTaskRecord {
  id: string;
  title: string;
  role: string | null;
  state: string;
  work_item_id: string | null;
  updated_at: string | null;
  description: string | null;
  review_feedback: string | null;
  verification_summary: string | null;
  subject_revision: number | null;
  escalation_reason: string | null;
  escalation_context: string | null;
  escalation_work_so_far: string | null;
  escalation_context_packet: Record<string, unknown> | null;
}

export interface WorkflowTaskBindingRecord {
  id: string;
  work_item_id: string | null;
}

export interface TaskActionSource {
  listTasks(
    tenantId: string,
    query: {
      workflow_id?: string;
      work_item_id?: string;
      state?: string;
      page: number;
      per_page: number;
    },
  ): Promise<{ data: Array<Record<string, unknown>> }>;
}

export interface WorkflowGateRecord {
  gate_id: string;
  stage_name: string;
  status: string;
  request_summary: string | null;
  recommendation: string | null;
  concerns: string[];
  requested_by_work_item_id: string | null;
  requested_by_task_title: string | null;
  requested_by_work_item_title: string | null;
}

export interface GateActionSource {
  listWorkflowGates(tenantId: string, workflowId: string): Promise<Array<Record<string, unknown>>>;
}

export interface WorkflowBoardNeedsActionItem extends WorkflowNeedsActionItem {
  stage_name?: string | null;
  subject_label?: string | null;
}

export type WorkspaceDeliverablesPacket = Omit<
  WorkflowWorkspacePacket['deliverables'],
  'final_deliverables' | 'in_progress_deliverables'
> & {
  final_deliverables: WorkflowDeliverableRecord[];
  in_progress_deliverables: WorkflowDeliverableRecord[];
  all_deliverables?: WorkflowDeliverableRecord[];
};
