#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { buildExecutionTurnItems } from '../../../apps/platform-api/src/services/workflow-operations/workflow-execution-log-composer.ts';

type LogRowLike = {
  id?: unknown;
  created_at?: unknown;
};

function readInput(): unknown {
  const raw = readFileSync(0, 'utf8').trim();
  return raw.length > 0 ? JSON.parse(raw) : [];
}

function readRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (isRecord(payload)) {
    const rows = payload.rows;
    if (Array.isArray(rows)) {
      return rows.filter(isRecord);
    }
    const data = payload.data;
    if (Array.isArray(data)) {
      return data.filter(isRecord);
    }
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareRowsNewestFirst(left: LogRowLike, right: LogRowLike): number {
  const leftTimestamp = String(left.created_at ?? '');
  const rightTimestamp = String(right.created_at ?? '');
  const timestampComparison = rightTimestamp.localeCompare(leftTimestamp);
  if (timestampComparison !== 0) {
    return timestampComparison;
  }
  return String(right.id ?? '').localeCompare(String(left.id ?? ''));
}

function readLogId(itemId: string): string | null {
  return itemId.startsWith('execution-log:') ? itemId.slice('execution-log:'.length) : null;
}

const rows = readRows(readInput()).sort(compareRowsNewestFirst);
const items = buildExecutionTurnItems(rows as never).map((item) => ({
  log_id: readLogId(item.item_id),
  item_id: item.item_id,
  headline: item.headline,
  summary: item.summary,
  task_id: item.task_id,
  work_item_id: item.work_item_id,
  linked_target_ids: item.linked_target_ids,
  scope_binding: item.scope_binding ?? null,
  source_kind: item.source_kind,
  source_label: item.source_label,
}));

process.stdout.write(`${JSON.stringify({ items }, null, 2)}\n`);
