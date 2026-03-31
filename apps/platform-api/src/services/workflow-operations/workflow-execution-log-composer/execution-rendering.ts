import type { LogRow } from '../../../logging/log-service.js';
import type { WorkflowLiveConsoleItem } from '../workflow-operations-types.js';

import {
  buildActionHeadline,
  isSuppressedActionName,
  readActText,
  readActSummary,
  readActionName,
  readPlanText,
  shouldSuppressActionInvocation,
} from './action-formatting.js';
import {
  readOperatorReadableField,
  readOperatorReadableText,
} from './console-text.js';
import { resolveExecutionTurnScope } from './execution-scope.js';
import { formatExecutionPhaseHeadline } from './execution-postprocess.js';
import {
  buildLLMExecutionTurnSummary,
  readLLMExecutionPhase,
} from './llm-phase.js';
import {
  asRecord,
  humanizeToken,
  normalizeTimestamp,
  readHumanizedString,
  readOptionalNumber,
  readString,
  readStringArray,
} from './shared.js';

export function buildExecutionTurnItem(row: LogRow): WorkflowLiveConsoleItem | null {
  if (row.operation === 'llm.chat_stream') {
    return buildLLMExecutionTurnItem(row);
  }
  if (!shouldRenderExecutionTurn(row)) {
    return null;
  }

  const scope = resolveExecutionTurnScope(row);
  return {
    item_id: `execution-log:${row.id}`,
    item_kind: 'execution_turn',
    source_kind: readLogSourceKind(row),
    source_label: readLogSourceLabel(row),
    headline: buildExecutionTurnHeadline(row),
    summary: buildExecutionTurnSummary(row),
    created_at: normalizeTimestamp(row.created_at),
    work_item_id: scope.workItemId,
    task_id: scope.taskId,
    linked_target_ids: scope.linkedTargetIds,
    scope_binding: scope.binding,
  };
}

export function readLogSourceKind(row: LogRow): string {
  return readString(row.role) ?? readString(row.actor_type) ?? row.source;
}

export function readLogSourceLabel(row: LogRow): string {
  return (
    readHumanizedString(row.role)
    ?? readString(row.actor_name)
    ?? readHumanizedString(row.actor_type)
    ?? humanizeToken(row.source)
  );
}

function buildLLMExecutionTurnItem(row: LogRow): WorkflowLiveConsoleItem | null {
  if (row.status !== 'completed') {
    return null;
  }

  const payload = asRecord(row.payload);
  const phase = readLLMExecutionPhase(payload);
  if (!phase) {
    return null;
  }

  const summary = buildLLMExecutionTurnSummary(phase, payload);
  if (!summary) {
    return null;
  }

  const scope = resolveExecutionTurnScope(row);
  return {
    item_id: `execution-log:${row.id}`,
    item_kind: 'execution_turn',
    source_kind: readLogSourceKind(row),
    source_label: readLogSourceLabel(row),
    headline: formatExecutionPhaseHeadline(`agent.${phase}`, summary),
    summary,
    created_at: normalizeTimestamp(row.created_at),
    work_item_id: scope.workItemId,
    task_id: scope.taskId,
    linked_target_ids: scope.linkedTargetIds,
    scope_binding: scope.binding,
  };
}

function buildExecutionTurnHeadline(row: LogRow): string {
  const payload = asRecord(row.payload);
  const subject = readExecutionSubject(row);

  const headline = (() => {
    switch (row.operation) {
      case 'agent.think':
      case 'runtime.loop.think':
        return (
          readThinkText(payload)
          ?? buildSubjectHeadline('Thinking through the next step for', subject, 'Thinking through the next step')
        );
      case 'agent.plan':
      case 'runtime.loop.plan':
        return (
          readPlanText(payload)
          ?? buildSubjectHeadline('Planning the next step for', subject, 'Planning the next step')
        );
      case 'agent.act': {
        const actionHeadline = buildActionHeadline(payload);
        return (
          readActText(payload, actionHeadline)
          ?? actionHeadline
          ?? buildSubjectHeadline('Working through', subject, 'Working through the next execution step')
        );
      }
      case 'agent.observe':
      case 'runtime.loop.observe':
        return (
          readObserveText(payload)
          ?? buildSubjectHeadline('Checking results for', subject, 'Checking execution results')
        );
      case 'agent.verify':
      case 'runtime.loop.verify':
        return (
          readVerifyText(payload)
          ?? readOperatorReadableText(buildVerifyHeadline(payload), 180)
          ?? buildSubjectHeadline('Checking', subject, 'Checking current progress')
        );
      default:
        return humanizeToken(row.operation);
    }
  })();

  return formatExecutionPhaseHeadline(row.operation, headline);
}

function buildExecutionTurnSummary(row: LogRow): string {
  const payload = asRecord(row.payload);
  const subject = readExecutionSubject(row);
  const detail =
    readActSummary(payload)
    ?? readPlanText(payload)
    ?? readThinkText(payload)
    ?? readObserveText(payload)
    ?? readVerifyText(payload)
    ?? readOperatorReadableField(payload, ['summary', 'details', 'reasoning_summary', 'approach'])
    ?? buildExecutionTurnFallbackSummary(row.operation, subject);
  return detail ?? humanizeToken(row.operation);
}

function shouldRenderExecutionTurn(row: LogRow): boolean {
  const payload = asRecord(row.payload);
  switch (row.operation) {
    case 'agent.think':
    case 'runtime.loop.think':
      return readThinkText(payload) !== null;
    case 'agent.plan':
    case 'runtime.loop.plan':
      return readPlanText(payload) !== null;
    case 'agent.act': {
      const actionName = readActionName(payload);
      const actionInput = asRecord(payload.input);
      if (isSuppressedActionName(actionName) || shouldSuppressActionInvocation(actionName, actionInput)) {
        return false;
      }
      const actionHeadline = buildActionHeadline(payload);
      return readActText(payload, actionHeadline) !== null || actionHeadline !== null;
    }
    case 'agent.observe':
    case 'runtime.loop.observe':
      return readObserveText(payload) !== null;
    case 'agent.verify':
    case 'runtime.loop.verify':
      return isMeaningfulVerify(payload);
    default:
      return true;
  }
}

function readExecutionSubject(row: LogRow): string | null {
  return readString(row.task_title) ?? readString(row.resource_name) ?? readString(row.workflow_name);
}

function buildSubjectHeadline(prefix: string, subject: string | null, fallback: string): string {
  return subject ? `${prefix} ${subject}` : fallback;
}

function readObserveText(payload: Record<string, unknown>): string | null {
  return (
    readOperatorReadableField(payload, ['headline', 'summary', 'details', 'text_preview'])
    ?? buildObservedExecutionText(payload)
  );
}

function buildObservedExecutionText(payload: Record<string, unknown>): string | null {
  const waitingReason = readWaitingObservationReason(payload);
  if (waitingReason) {
    return waitingReason;
  }

  const observedExecution = readObservedExecutionDetails(payload);
  if (!observedExecution.targets) {
    return null;
  }
  if (observedExecution.errorsCount > 0) {
    return `Observed errors while handling ${observedExecution.targets}.`;
  }
  if (payload.signal_mutation === true) {
    return `Observed updates from ${observedExecution.targets}.`;
  }
  return `Observed current results from ${observedExecution.targets}.`;
}

function readWaitingObservationReason(payload: Record<string, unknown>): string | null {
  const explicitReason = readOperatorReadableText(
    readString(payload.waiting_on_workflow_event_reason),
    180,
  );
  if (explicitReason) {
    return explicitReason.charAt(0).toUpperCase() + explicitReason.slice(1);
  }
  return payload.waiting_on_active_work === true
    ? 'Observed the workflow waiting on active work.'
    : null;
}

function readObservedExecutionDetails(payload: Record<string, unknown>): {
  targets: string | null;
  errorsCount: number;
} {
  const directTargets = readObservedToolTargets(payload);
  const directErrorsCount = readOptionalNumber(payload.errors_count) ?? 0;
  if (directTargets) {
    return {
      targets: directTargets,
      errorsCount: directErrorsCount,
    };
  }

  const rawSummary = readString(payload.summary) ?? readString(payload.text_preview);
  const parsed = rawSummary ? parseObservedExecutionSummary(rawSummary) : null;
  if (!parsed) {
    return {
      targets: null,
      errorsCount: directErrorsCount,
    };
  }

  return {
    targets: joinNaturalLanguageTargets(
      parsed.toolNames
        .map(humanizeObservedToolName)
        .filter((value): value is string => value !== null),
    ),
    errorsCount: parsed.errorsCount ?? directErrorsCount,
  };
}

function readObservedToolTargets(payload: Record<string, unknown>): string | null {
  const targets = readStringArray(payload.signal_tools)
    .map(humanizeObservedToolName)
    .filter((value): value is string => value !== null);
  return targets.length === 0 ? null : joinNaturalLanguageTargets(targets);
}

function parseObservedExecutionSummary(value: string): {
  toolNames: string[];
  errorsCount: number | null;
} | null {
  const match = value.match(
    /^executed\s+\d+\s+tools?\s+\(\d+\s+succeeded,\s+(\d+)\s+failed\):\s+(.+?)(?:\.\s+errors:|$)/i,
  );
  if (!match) {
    return null;
  }
  const [, failedCountText, toolListText] = match;
  return {
    toolNames: toolListText
      .split(',')
      .map((entry) => readString(entry))
      .filter((entry): entry is string => entry !== null),
    errorsCount: Number.parseInt(failedCountText, 10),
  };
}

function humanizeObservedToolName(toolName: string): string | null {
  switch (toolName) {
    case 'record_operator_brief':
    case 'record_operator_update':
    case 'file_read':
    case 'file_write':
    case 'file_edit':
    case 'file_list':
    case 'artifact_document_read':
    case 'artifact_list':
    case 'artifact_read':
    case 'grep':
    case 'memory_read':
    case 'list_workflow_tasks':
    case 'list_work_items':
    case 'submit_handoff':
      return null;
    case 'read_latest_handoff':
      return 'latest brief';
    case 'read_work_item_continuity':
      return 'work item continuity';
    case 'read_stage_status':
      return 'stage status';
    case 'read_task_status':
      return 'task status';
    case 'read_task_output':
      return 'task output';
    case 'read_task_events':
      return 'task events';
    case 'create_task':
      return 'task creation';
    case 'complete_work_item':
      return 'work item completion';
    case 'complete_workflow':
      return 'workflow completion';
    default: {
      const normalized = humanizeToken(toolName).toLowerCase();
      return normalized.length > 0 ? normalized : null;
    }
  }
}

function joinNaturalLanguageTargets(values: string[]): string | null {
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length === 0) {
    return null;
  }
  if (uniqueValues.length === 1) {
    return uniqueValues[0] ?? null;
  }
  if (uniqueValues.length === 2) {
    return `${uniqueValues[0]} and ${uniqueValues[1]}`;
  }
  return `${uniqueValues.slice(0, -1).join(', ')}, and ${uniqueValues.at(-1)}`;
}

function readVerifyText(payload: Record<string, unknown>): string | null {
  return readOperatorReadableField(payload, ['headline', 'summary', 'details']);
}

function isMeaningfulVerify(payload: Record<string, unknown>): boolean {
  const text = readVerifyText(payload);
  if (!text) {
    return false;
  }
  const status = readString(payload.status);
  const decision = readString(payload.decision);
  return (
    isMeaningfulVerifyToken(status)
    || isMeaningfulVerifyToken(decision)
    || /\b(blocked|waiting|wait|rework|request changes|approved|rejected|failed|complete|completed)\b/i.test(text)
  );
}

function isMeaningfulVerifyToken(value: string | null): boolean {
  return value !== null
    && /^(blocked|waiting|wait|rework|request_changes|approved|rejected|failed|complete|completed)$/i.test(
      value,
    );
}

function readThinkText(payload: Record<string, unknown>): string | null {
  return readOperatorReadableField(payload, ['headline', 'reasoning_summary', 'approach']);
}

function buildVerifyHeadline(payload: Record<string, unknown>): string | null {
  const status = readString(payload.status);
  const decision = readString(payload.decision);
  if (status && decision) {
    return `Verification ${humanizeToken(status)}: ${humanizeToken(decision)}`;
  }
  if (status) {
    return `Verification ${humanizeToken(status)}`;
  }
  if (decision) {
    return `Verification ${humanizeToken(decision)}`;
  }
  return null;
}

function buildExecutionTurnFallbackSummary(operation: string, subject: string | null): string {
  if (operation === 'agent.observe' || operation === 'agent.verify') {
    return subject ? `Checked the latest results for ${subject}.` : 'Checked the latest execution results.';
  }
  return subject ? `Working through the next step for ${subject}.` : 'Working through the next execution step.';
}
