import type { LogEntry } from '../../lib/api.js';
import { describeToolOwner } from './log-entry-presentation.actor.js';
import {
  endsWithTokens,
  firstDefinedString,
  humanizeSentence,
  isRecord,
  lowercaseFirst,
  readOptionalInt,
  readString,
  readStringArray,
  startsWithTokens,
  tokenizeLabel,
  truncateSummary,
} from './log-entry-presentation.shared.js';

export function describeLogToolDisplay(entry: LogEntry): string | null {
  const invocation = readToolInvocation(entry.payload);
  if (!invocation) {
    return null;
  }
  const label = describeToolLabel(invocation.name, entry.payload);
  if (!label) {
    return null;
  }

  const summary = describeToolArgumentSummaryByName(
    invocation.name,
    invocation.input,
    entry.payload ?? {},
  );
  return summary ? `${label}(${summary})` : label;
}

export function readLogToolLabel(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const raw =
    readString(payload?.tool_name) ??
    readString(payload?.command_or_path) ??
    readString(payload?.command);
  return describeToolLabel(raw, payload);
}

export function readMCPToolLabel(
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const serverName = readString(payload?.mcp_server_name) ?? readString(payload?.mcp_server_slug);
  const toolName = readString(payload?.mcp_tool_name);
  if (!serverName && !toolName) {
    return null;
  }

  const serverLabel = serverName ? describeMCPServerLabel(serverName) : null;
  const toolLabel = toolName ? humanizeSentence(stripMCPServerTokens(toolName, serverName)) : null;
  if (serverLabel && toolLabel) {
    return `MCP ${serverLabel} ${lowercaseFirst(toolLabel)}`;
  }
  if (serverLabel) {
    return `MCP ${serverLabel}`;
  }
  if (toolLabel) {
    return `MCP ${toolLabel}`;
  }
  return null;
}

function describeToolLabel(
  toolName: string | null,
  payload: Record<string, unknown> | null | undefined,
): string | null {
  const mcpLabel = readMCPToolLabel(payload);
  if (mcpLabel) {
    return mcpLabel;
  }
  return toolName ? humanizeSentence(toolName) : null;
}

function describeMCPServerLabel(serverName: string): string {
  const normalized = tokenizeLabel(serverName);
  if (normalized.length === 0) {
    return humanizeSentence(serverName);
  }
  return humanizeSentence(normalized.join('_'));
}

function stripMCPServerTokens(toolName: string, serverName: string | null): string {
  const toolTokens = tokenizeLabel(toolName);
  const serverTokens = tokenizeLabel(serverName);
  if (toolTokens.length === 0 || serverTokens.length === 0) {
    return toolName;
  }

  let start = 0;
  let end = toolTokens.length;
  if (startsWithTokens(toolTokens, serverTokens)) {
    start = serverTokens.length;
  }
  const remainingTokens = toolTokens.slice(start, end);
  if (endsWithTokens(remainingTokens, serverTokens)) {
    end -= serverTokens.length;
  }

  const trimmed = toolTokens.slice(start, end);
  return trimmed.length > 0 ? trimmed.join('_') : toolName;
}

function describeToolArgumentSummaryByName(
  toolName: string | null,
  input: Record<string, unknown> | null,
  payload: Record<string, unknown>,
): string | null {
  switch (toolName) {
    case 'shell_exec':
      return truncateSummary(readString(input?.command) ?? '');
    case 'file_read':
      return formatPathRangeSummary(input);
    case 'file_write':
    case 'file_edit':
    case 'file_list':
    case 'artifact_upload':
    case 'artifact_read':
    case 'artifact_document_read':
    case 'memory_delete':
    case 'work_item_memory_read':
    case 'work_item_memory_history':
      return truncateSummary(
        firstDefinedString([
          readString(input?.path),
          readString(input?.logical_path),
          readString(input?.artifact_name),
          readString(input?.artifact_id),
          readString(input?.key),
        ]) ?? '',
      );
    case 'glob':
      return formatPatternPathSummary(input);
    case 'grep':
      return formatGrepSummary(input);
    case 'git_commit':
      return truncateSummary(readString(input?.message) ?? '');
    case 'git_push':
      return truncateSummary(readString(input?.branch) ?? 'origin/HEAD');
    case 'git_diff':
      return truncateSummary(
        firstDefinedString([readString(input?.path), readString(input?.ref)]) ?? 'HEAD',
      );
    case 'git_log':
      return truncateSummary(readString(input?.ref) ?? 'HEAD');
    case 'memory_read':
      return formatMemoryReadSummary(input);
    case 'memory_search':
      return truncateSummary(readString(input?.query) ?? '');
    case 'memory_write':
      return formatMemoryWriteSummary(input);
    case 'submit_handoff':
      return formatSubmitHandoffSummary(input);
    case 'read_predecessor_handoff':
    case 'git_status':
    case 'read_stage_status':
    case 'read_workflow_budget':
      return null;
    case 'read_latest_handoff':
    case 'read_handoff_chain':
    case 'read_work_item_continuity':
      return truncateSummary(readString(input?.work_item_id) ?? '');
    case 'list_work_items':
      return joinSummaryParts([
        readString(input?.stage_name),
        readString(input?.column_id),
        readString(input?.parent_work_item_id),
      ]);
    case 'list_workflow_tasks':
      return joinSummaryParts([
        readString(input?.stage_name),
        readString(input?.state),
        readString(input?.work_item_id),
      ]);
    case 'read_task_output':
    case 'read_task_status':
    case 'read_task_events':
    case 'update_task_input':
    case 'cancel_task':
    case 'retry_task':
    case 'approve_task':
    case 'approve_task_output':
    case 'request_rework':
    case 'send_task_message':
    case 'reassign_task':
      return truncateSummary(readString(input?.task_id) ?? '');
    case 'read_escalation':
      return truncateSummary(
        firstDefinedString([readString(input?.task_id), readString(input?.escalation_id)]) ?? '',
      );
    case 'create_work_item':
      return joinSummaryParts([readString(input?.title), readString(input?.stage_name)]);
    case 'update_work_item':
    case 'complete_work_item':
      return truncateSummary(
        firstDefinedString([readString(input?.id), readString(input?.work_item_id)]) ?? '',
      );
    case 'create_task':
      return joinSummaryParts([readString(input?.role), readString(input?.title)]);
    case 'request_gate_approval':
      return truncateSummary(readString(input?.stage_name) ?? '');
    case 'advance_stage':
      return joinSummaryParts([readString(input?.stage_name), readString(input?.to_stage_name)]);
    case 'complete_workflow':
      return null;
    case 'create_workflow':
      return joinSummaryParts([readString(input?.name), readString(input?.playbook_id)]);
    case 'web_fetch':
      return truncateSummary(readString(input?.url) ?? '');
    case 'spawn_agent':
      return truncateSummary(readString(input?.description) ?? '');
    default:
      return formatGenericToolSummary(input, payload);
  }
}

function formatPathRangeSummary(input: Record<string, unknown> | null): string | null {
  const path = readString(input?.path);
  if (!path) {
    return null;
  }
  const offset = readOptionalInt(input?.offset);
  const limit = readOptionalInt(input?.limit);
  if (!offset || !limit) {
    return truncateSummary(path);
  }
  return truncateSummary(`${path}:${offset}-${offset + limit - 1}`);
}

function formatPatternPathSummary(input: Record<string, unknown> | null): string | null {
  return formatPathPatternSummary(input);
}

function formatGrepSummary(input: Record<string, unknown> | null): string | null {
  return formatPathPatternSummary(input);
}

function formatPathPatternSummary(input: Record<string, unknown> | null): string | null {
  const pattern = readString(input?.pattern);
  const path = readString(input?.path);
  if (pattern && path) {
    return truncateSummary(`${pattern} @ ${path}`);
  }
  return truncateSummary(pattern ?? path ?? '');
}

function formatMemoryReadSummary(input: Record<string, unknown> | null): string | null {
  const key = readString(input?.key);
  if (key) {
    return truncateSummary(key);
  }
  const keys = readStringArray(input?.keys);
  if (keys.length === 1) {
    return truncateSummary(keys[0] ?? '');
  }
  if (keys.length > 1) {
    return truncateSummary(`${keys.length} keys`);
  }
  return null;
}

function formatMemoryWriteSummary(input: Record<string, unknown> | null): string | null {
  const updates = isRecord(input?.updates) ? input?.updates : null;
  if (!updates) {
    return null;
  }
  const keys = Object.keys(updates)
    .filter((key) => key.trim().length > 0)
    .sort();
  if (keys.length === 0) {
    return null;
  }
  if (keys.length === 1) {
    return truncateSummary(keys[0] ?? '');
  }
  return truncateSummary(`${keys[0]}, +${keys.length - 1} more`);
}

function formatSubmitHandoffSummary(input: Record<string, unknown> | null): string | null {
  return joinSummaryParts([
    readString(input?.completion),
    readString(input?.resolution),
    readString(input?.outcome_action_applied),
  ]);
}

function formatGenericToolSummary(
  input: Record<string, unknown> | null,
  payload: Record<string, unknown>,
): string | null {
  const directSummary = firstDefinedString([
    readString(input?.command),
    readString(input?.path),
    readString(input?.query),
    readString(input?.url),
    readString(input?.handoff_id),
    readString(input?.task_id),
    readString(input?.workflow_id),
    readString(input?.work_item_id),
    readString(input?.stage_name),
    readString(input?.name),
    readString(payload.path),
  ]);

  if (directSummary) {
    return truncateSummary(directSummary);
  }

  const src = readString(input?.src);
  const dst = readString(input?.dst);
  if (src && dst) {
    return truncateSummary(`${src} -> ${dst}`);
  }

  return null;
}

function joinSummaryParts(parts: Array<string | null>): string | null {
  const values = parts.map((part) => part?.trim() ?? '').filter((part) => part.length > 0);
  if (values.length === 0) {
    return null;
  }
  return truncateSummary(values.join(' · '));
}

function readToolInvocation(
  payload: Record<string, unknown> | null | undefined,
): { name: string; input: Record<string, unknown> | null } | null {
  if (!payload) {
    return null;
  }

  const directToolName = readString(payload.tool_name);
  if (directToolName) {
    return {
      name: directToolName,
      input: isRecord(payload.input) ? payload.input : null,
    };
  }

  const phaseToolName = readString(payload.tool);
  if (phaseToolName) {
    return {
      name: phaseToolName,
      input: isRecord(payload.input) ? payload.input : null,
    };
  }

  const responseToolCalls = Array.isArray(payload.response_tool_calls)
    ? payload.response_tool_calls
    : [];
  for (const item of responseToolCalls) {
    const invocation = readToolCallRecord(item);
    if (invocation) {
      return invocation;
    }
  }

  const toolCalls = Array.isArray(payload.tool_calls) ? payload.tool_calls : [];
  for (const item of toolCalls) {
    if (typeof item === 'string' && item.trim().length > 0) {
      return { name: item, input: null };
    }
    const invocation = readToolCallRecord(item);
    if (invocation) {
      return invocation;
    }
  }

  return null;
}

function readToolCallRecord(
  value: unknown,
): { name: string; input: Record<string, unknown> | null } | null {
  if (!isRecord(value)) {
    return null;
  }

  const name =
    readString(value.name) ?? (isRecord(value.function) ? readString(value.function.name) : null);
  if (!name) {
    return null;
  }

  const directInput = isRecord(value.input) ? value.input : null;
  if (directInput) {
    return { name, input: directInput };
  }

  const functionArguments = isRecord(value.function)
    ? parseToolArguments(value.function.arguments)
    : null;
  if (functionArguments) {
    return { name, input: functionArguments };
  }

  return { name, input: null };
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
