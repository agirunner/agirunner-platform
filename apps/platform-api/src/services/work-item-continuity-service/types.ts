import type { PlaybookRuleEvaluationResult } from '../playbook-rule-evaluation-service.js';

export interface WorkItemContinuityContextRow {
  workflow_id: string;
  work_item_id: string;
  stage_name: string | null;
  rework_count: number | null;
  owner_role: string | null;
  next_expected_actor: string | null;
  next_expected_action: string | null;
  definition: unknown;
}

export interface CurrentFinishStateRow {
  next_expected_actor: string | null;
  next_expected_action: string | null;
  parent_work_item_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface WorkflowActivationQueuedAtRow {
  queued_at: Date | null;
}

export interface NewerSpecialistHandoffRow {
  has_newer_specialist_handoff: boolean;
}

export interface WorkItemCompletionOutcome extends PlaybookRuleEvaluationResult {
  satisfiedAssessmentExpectation: boolean;
}

export interface OrchestratorFinishStateUpdate {
  next_expected_actor?: string | null;
  next_expected_action?: string | null;
  status_summary?: string;
  next_expected_event?: string;
  blocked_on?: string[];
  active_subordinate_tasks?: string[];
}
