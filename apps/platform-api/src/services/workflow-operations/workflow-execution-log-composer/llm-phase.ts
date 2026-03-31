import type { LogRow } from '../../../logging/log-service.js';

import {
  buildActionHeadline,
  buildActionInvocationHeadline,
  joinActionHeadlines,
  shouldSuppressActionInvocation,
} from './action-formatting.js';
import {
  looksLikeLowValueConsoleText,
  looksLikeSyntheticActionPreview,
  readOperatorReadableField,
  readOperatorReadableText,
  stripExecutionPhasePrefix,
} from './console-text.js';
import {
  buildExecutionPhaseKey,
  buildLLMResponseCompanionKey,
} from './phase-keys.js';
import {
  asRecord,
  compareLogRowsByCreatedAt,
  readString,
} from './shared.js';

export function hydrateLLMPhaseRows(rows: LogRow[]): LogRow[] {
  const responseRowsByTurnKey = collectLLMResponseRowsByTurnKey(rows);
  return rows.map((row) => hydrateLLMPhaseRow(row, responseRowsByTurnKey));
}

export function collectPreferredLLMPhaseKeys(rows: LogRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.operation !== 'llm.chat_stream') {
      continue;
    }
    const payload = asRecord(row.payload);
    const phase = readLLMExecutionPhase(payload);
    const key = phase ? buildExecutionPhaseKey(row, phase, payload) : null;
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

export function readLLMExecutionPhase(
  payload: Record<string, unknown>,
): 'think' | 'plan' | 'act' | 'observe' | 'verify' | null {
  const phase = readString(payload.phase);
  if (
    phase === 'think'
    || phase === 'plan'
    || phase === 'act'
    || phase === 'observe'
    || phase === 'verify'
  ) {
    return phase;
  }
  return null;
}

export function buildLLMExecutionTurnSummary(
  phase: 'think' | 'plan' | 'act' | 'observe' | 'verify',
  payload: Record<string, unknown>,
): string | null {
  switch (phase) {
    case 'think':
      return (
        readLoggedResponseField(payload, ['approach', 'reasoning_summary', 'headline'])
        ?? readLoggedResponseText(payload, 180)
      );
    case 'plan':
      return (
        readLoggedResponseField(payload, ['summary', 'plan_summary', 'headline'])
        ?? readOperatorReadableText(readFirstPlanDescription(readLoggedResponseFieldValue(payload, 'steps')), 180)
        ?? readLoggedResponseText(payload, 180)
      );
    case 'act': {
      const prose = readLoggedResponseField(payload, ['headline', 'summary', 'details'])
        ?? readLoggedResponseText(payload, 180);
      if (
        prose
        && !looksLikeSyntheticLoggedToolCall(prose, payload)
        && !looksLikeLowValueConsoleText(stripExecutionPhasePrefix(prose))
      ) {
        return prose;
      }
      return buildLoggedToolCallSummary(payload);
    }
    case 'observe':
      return (
        readLoggedResponseField(payload, ['summary', 'headline', 'details'])
        ?? readLoggedResponseText(payload, 180)
      );
    case 'verify':
      return (
        readLoggedResponseField(payload, ['reason', 'summary', 'headline'])
        ?? readLoggedResponseText(payload, 180)
      );
    default:
      return null;
  }
}

function collectLLMResponseRowsByTurnKey(rows: LogRow[]): Map<string, LogRow> {
  const responseRows = new Map<string, LogRow>();
  for (const row of rows) {
    if (row.operation !== 'llm.chat_stream') {
      continue;
    }
    const payload = asRecord(row.payload);
    if (readLLMExecutionPhase(payload) || !hasLoggedResponseContent(payload)) {
      continue;
    }
    const key = buildLLMResponseCompanionKey(row, payload);
    if (!key) {
      continue;
    }
    const existing = responseRows.get(key);
    if (!existing || compareLogRowsByCreatedAt(existing, row) > 0) {
      responseRows.set(key, row);
    }
  }
  return responseRows;
}

function hydrateLLMPhaseRow(
  row: LogRow,
  responseRowsByTurnKey: Map<string, LogRow>,
): LogRow {
  if (row.operation !== 'llm.chat_stream') {
    return row;
  }
  const payload = asRecord(row.payload);
  if (!readLLMExecutionPhase(payload) || hasLoggedResponseContent(payload)) {
    return row;
  }
  const companionKey = buildLLMResponseCompanionKey(row, payload);
  if (!companionKey) {
    return row;
  }
  const companionRow = responseRowsByTurnKey.get(companionKey);
  if (!companionRow) {
    return row;
  }
  const companionPayload = asRecord(companionRow.payload);
  return {
    ...row,
    status: row.status === 'completed' ? row.status : companionRow.status,
    created_at: compareLogRowsByCreatedAt(row, companionRow) <= 0
      ? companionRow.created_at
      : row.created_at,
    payload: {
      ...companionPayload,
      ...payload,
      response_text: readString(payload.response_text) ?? readString(companionPayload.response_text),
      response_summary: readString(payload.response_summary)
        ?? readString(companionPayload.response_summary),
      response_tool_calls:
        Array.isArray(payload.response_tool_calls) && payload.response_tool_calls.length > 0
          ? payload.response_tool_calls
          : companionPayload.response_tool_calls,
    },
  };
}

function hasLoggedResponseContent(payload: Record<string, unknown>): boolean {
  return (
    readString(payload.response_text) !== null
    || readString(payload.response_summary) !== null
    || (Array.isArray(payload.response_tool_calls) && payload.response_tool_calls.length > 0)
  );
}

function readLoggedResponseField(
  payload: Record<string, unknown>,
  keys: string[],
): string | null {
  const parsedRecords = readLoggedResponseRecords(payload);
  for (const parsed of parsedRecords) {
    const value = readOperatorReadableField(parsed, keys);
    if (value) {
      return value;
    }
  }
  return null;
}

function readLoggedResponseFieldValue(
  payload: Record<string, unknown>,
  key: string,
): unknown {
  const parsedRecords = readLoggedResponseRecords(payload);
  for (const parsed of parsedRecords) {
    if (Object.hasOwn(parsed, key)) {
      return parsed[key];
    }
  }
  return undefined;
}

function readLoggedResponseText(payload: Record<string, unknown>, maxLength: number): string | null {
  const rawResponse =
    readString(stripMarkdownCodeFences(readString(payload.response_text)))
    ?? readString(stripMarkdownCodeFences(readString(payload.response_summary)));
  return readOperatorReadableText(rawResponse, maxLength);
}

function readLoggedResponseRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  const rawResponse =
    readString(stripMarkdownCodeFences(readString(payload.response_text)))
    ?? readString(stripMarkdownCodeFences(readString(payload.response_summary)));
  if (!rawResponse) {
    return [];
  }

  const parsedRecords: Record<string, unknown>[] = [];
  const directRecord = tryParseJSONObject(rawResponse);
  if (directRecord) {
    parsedRecords.push(directRecord);
  }

  for (const segment of extractJSONObjectSegments(rawResponse)) {
    const record = tryParseJSONObject(segment);
    if (record) {
      parsedRecords.push(record);
    }
  }

  return dedupeResponseRecords(parsedRecords);
}

function tryParseJSONObject(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function extractJSONObjectSegments(value: string): string[] {
  const start = value.indexOf('{');
  if (start < 0) {
    return [];
  }

  const segments: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let segmentStart = start;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined) {
      break;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === '{') {
      if (depth === 0) {
        segmentStart = index;
      }
      depth += 1;
      continue;
    }
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        segments.push(value.slice(segmentStart, index + 1));
      }
    }
  }

  return segments;
}

function dedupeResponseRecords(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const uniqueRecords = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    uniqueRecords.set(JSON.stringify(record), record);
  }
  return [...uniqueRecords.values()];
}

function stripMarkdownCodeFences(value: string | null): string | null {
  const parsed = readString(value);
  if (!parsed) {
    return null;
  }
  const fenceMatch = parsed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch?.[1] ? fenceMatch[1].trim() : parsed;
}

function readLoggedToolCalls(payload: Record<string, unknown>): Array<{
  name: string;
  input: Record<string, unknown>;
}> {
  const toolCalls = payload.response_tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const parsedCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  for (const entry of toolCalls) {
    const record = asRecord(entry);
    const name = readString(record.name);
    if (!name) {
      continue;
    }
    parsedCalls.push({
      name,
      input: asRecord(record.input),
    });
  }
  return parsedCalls;
}

function buildLoggedToolCallSummary(payload: Record<string, unknown>): string | null {
  const renderedCalls = readLoggedToolCalls(payload)
    .map(({ name, input }) => {
      if (shouldSuppressActionInvocation(name, input)) {
        return null;
      }
      return buildActionHeadline({ tool: name, input })
        ?? buildActionInvocationHeadline({ tool: name, input });
    })
    .filter((value): value is string => value !== null);

  if (renderedCalls.length === 0) {
    return null;
  }
  return readOperatorReadableText(joinActionHeadlines(renderedCalls), 180);
}

function looksLikeSyntheticLoggedToolCall(
  value: string,
  payload: Record<string, unknown>,
): boolean {
  const normalized = stripSyntheticActionSourcePrefix(value).toLowerCase();
  if (normalized.startsWith('calling ')) {
    return true;
  }
  const toolCalls = readLoggedToolCalls(payload);
  if (toolCalls.length === 0) {
    return false;
  }
  return toolCalls.some(({ name, input }) => {
    const actionHeadline = buildActionHeadline({ tool: name, input })
      ?? buildActionInvocationHeadline({ tool: name, input });
    return looksLikeSyntheticActionPreview(value, actionHeadline, name);
  });
}

function stripSyntheticActionSourcePrefix(value: string): string {
  return value.replace(/^[^:\n]{1,64}:\s*/, '').trim();
}

function readFirstPlanDescription(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const description = readString((entry as Record<string, unknown>).description);
    if (description) {
      return description;
    }
  }
  return null;
}
