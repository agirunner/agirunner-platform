import { guidedClosureContextSchema } from '../guided-closure/types.js';
import { asRecord, readNumber, readString, readStringArray } from './shared.js';

export function formatClosureContext(workflow: Record<string, unknown>) {
  const parsed = guidedClosureContextSchema.safeParse(asRecord(workflow.closure_context));
  if (!parsed.success) {
    return '';
  }

  const lines = [
    `Closure readiness: ${parsed.data.closure_readiness}`,
    `Work item can close now: ${parsed.data.work_item_can_close_now ? 'yes' : 'no'}`,
    `Workflow can close now: ${parsed.data.workflow_can_close_now ? 'yes' : 'no'}`,
  ];
  if (parsed.data.open_specialist_task_count > 0) {
    lines.push(`Open specialist tasks on current work item: ${parsed.data.open_specialist_task_count}`);
  }
  if (parsed.data.open_specialist_task_roles.length > 0) {
    lines.push(`Open specialist task roles: ${parsed.data.open_specialist_task_roles.join(', ')}`);
  }
  for (const control of parsed.data.active_blocking_controls) {
    lines.push(`Blocking control ${control.kind} ${control.id}: ${control.summary ?? 'Blocking control remains open.'}`);
  }
  for (const control of parsed.data.active_advisory_controls) {
    lines.push(`Advisory control ${control.kind} ${control.id}: ${control.summary ?? 'Advisory control remains open.'}`);
  }
  for (const obligation of parsed.data.preferred_obligations) {
    lines.push(`Preferred obligation ${obligation.subject} (${obligation.code}): ${obligation.status}`);
  }
  for (const outcome of parsed.data.recent_recovery_outcomes) {
    lines.push(`Recent recovery ${outcome.recovery_class}`);
  }
  const workItemAttempts = Object.entries(parsed.data.attempt_count_by_work_item);
  if (workItemAttempts.length > 0) {
    lines.push(`Attempt counts by work item: ${workItemAttempts.map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  const roleAttempts = Object.entries(parsed.data.attempt_count_by_role);
  if (roleAttempts.length > 0) {
    lines.push(`Attempt counts by role: ${roleAttempts.map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  for (const failure of parsed.data.recent_failures) {
    lines.push(`Recent failure ${failure.role ?? 'unknown-role'} on ${failure.task_id}: ${failure.why}`);
  }
  if (parsed.data.retry_window) {
    lines.push(
      `Retry window: available at ${parsed.data.retry_window.retry_available_at} after ${parsed.data.retry_window.backoff_seconds} seconds`,
    );
  }
  if (parsed.data.reroute_candidates.length > 0) {
    lines.push(`Reroute candidates: ${parsed.data.reroute_candidates.join(', ')}`);
  }
  return lines.join('\n');
}

export function guidedRecoveryGuidance() {
  return [
    'Use platform-produced closure_context, recent recovery outcomes, and attempt history as the recovery contract; do not guess from prose or stale memory.',
    'If a workflow mutation returns recoverable_not_applied, treat it as platform guidance: inspect current state, follow suggested_next_actions, and do not loop the same stale mutation again in the same state.',
    'Follow a fallback ladder: retry transient failures, inspect canonical state, reroute or reassign, rerun missing predecessor work with a corrected brief, waive preferred steps explicitly, close with callouts if legal, and escalate only when closure is impossible without external input.',
    'If recovery options are exhausted and closure remains legal, close with callouts if closure is legal instead of leaving the workflow open.',
  ].join('\n');
}

export function formatOperatorVisibilitySection(liveVisibility: Record<string, unknown>): string {
  if (Object.keys(liveVisibility).length === 0) {
    return '';
  }

  const lines: string[] = [];
  const mode = readString(liveVisibility.mode);
  const workflowId = readString(liveVisibility.workflow_id);
  const workItemId = readString(liveVisibility.work_item_id);
  const taskId = readString(liveVisibility.task_id);
  const executionContextId = readString(liveVisibility.execution_context_id);
  const recordOperatorBriefTool = readString(liveVisibility.record_operator_brief_tool);
  const operatorBriefRequestIdPrefix = readString(liveVisibility.operator_brief_request_id_prefix);

  if (mode) lines.push(`Live visibility mode: ${mode}`);
  if (workflowId) lines.push(`Workflow id: ${workflowId}`);
  if (workItemId) lines.push(`Work item id: ${workItemId}`);
  if (taskId) lines.push(`Task id: ${taskId}`);
  if (executionContextId) lines.push(`Execution context id: ${executionContextId}`);
  lines.push(
    'Standard live visibility comes from canonical workflow events and required briefs, not from an extra model-authored operator-update tool.',
  );
  if (mode === 'enhanced') {
    lines.push(
      'Enhanced live visibility streams trimmed execution output automatically from the persisted loop phases. Do not add a reporting step just to keep the console moving.',
    );
  }
  lines.push(
    'Operator briefs and live-console phase lines are console text, not audit logs: keep them human-readable, use titles and roles when available, and never dump tool chatter, phases, JSON, UUIDs, or lines like "Ran File Read", "tool_failure", or "executed 2 tools".',
  );
  lines.push(
    'If you do not have the exact scoped workflow, work-item, or task ids from the live visibility contract, omit those optional ids and let the runtime derive the canonical linkage from execution_context_id.',
  );

  if (liveVisibility.milestone_briefs_required === true && recordOperatorBriefTool) {
    lines.push(
      'Every operator brief write must include a unique request_id. Reuse a request_id only for an intentional retry of the same write.',
    );
    if (operatorBriefRequestIdPrefix) {
      lines.push(
        `Use ${operatorBriefRequestIdPrefix} as the stable request_id prefix for ${recordOperatorBriefTool} writes in this execution context.`,
      );
    }
    lines.push(
      `Use ${recordOperatorBriefTool} for material handoff or milestone summaries when the platform requests them.`,
    );
    lines.push(
      `If this task reaches a meaningful completion, handoff, approval, or output checkpoint without the required ${recordOperatorBriefTool}, completion will be rejected recoverably until you emit it.`,
    );
    lines.push(
      'Use brief_kind milestone for in-flight progress or handoff summaries and brief_kind terminal only for the final workflow outcome summary.',
    );
    lines.push(
      `${recordOperatorBriefTool} payload must include short_brief and detailed_brief_json objects.`,
    );
    lines.push('short_brief must include a headline.');
    lines.push(
      'record_operator_brief requires short_brief.headline plus detailed_brief_json.headline and status_kind, and must never be called with only linked_target_ids or an empty brief shell.',
    );
    lines.push(
      'record_operator_brief does not satisfy a required submit_handoff and does not by itself complete a task, work item, or workflow.',
    );
  }

  return lines.length > 0 ? `## Operator Visibility\n${lines.join('\n')}` : '';
}

export function formatPendingDispatches(
  pendingDispatches: Array<{ work_item_id: string; stage_name: string | null; actor: string; action: string; title: string | null }>,
): string {
  const lines = pendingDispatches.map((entry) => {
    const workItemLabel = entry.stage_name
      ? `work item ${entry.work_item_id} (${entry.stage_name})`
      : `work item ${entry.work_item_id}`;
    const titleSuffix = entry.title ? ` titled "${entry.title}"` : '';
    return `- Dispatch ${entry.actor} for ${entry.action} on ${workItemLabel}${titleSuffix}.`;
  });
  if (pendingDispatches.some((entry) => entry.action === 'assess')) {
    lines.push('A predecessor task remaining in output_pending_assessment is expected while a real assessment task is pending and does not block dispatching the listed assessment task.');
  }
  lines.push('If a pending dispatch is listed and no matching specialist task is already open, create that task in this activation.');
  return lines.join('\n');
}

export function formatRoleCatalog(
  roles: Array<{ name: string; description: string | null }>,
): string {
  return roles
    .map((role) => `- ${role.name}: ${role.description ?? 'No description configured.'}`)
    .join('\n');
}
