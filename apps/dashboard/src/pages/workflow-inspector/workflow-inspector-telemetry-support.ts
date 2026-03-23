import type { LogStatsResponse } from '../../lib/api.js';
import { formatCost } from '../../components/execution-inspector/execution-inspector-support.js';

export function buildWorkflowInspectorLink(
  workflowId: string,
  params: Record<string, string>,
): string {
  const searchParams = new URLSearchParams(params);
  return `/work/boards/${workflowId}/inspector?${searchParams.toString()}`;
}

export function topCostGroup(
  stats: LogStatsResponse | undefined,
  predicate: (group: LogStatsResponse['data']['groups'][number]) => boolean,
) {
  return [...(stats?.data.groups ?? [])]
    .filter(predicate)
    .filter((group) => readGroupCost(group) > 0)
    .sort((left, right) => readGroupCost(right) - readGroupCost(left))[0];
}

export function readGroupCost(group: LogStatsResponse['data']['groups'][number]): number {
  return Number(group.agg.total_cost_usd ?? 0);
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
      )
    : [];
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function buildStatsBreakdownEntries(
  stats: LogStatsResponse | undefined,
  helpers: {
    formatLabel(group: LogStatsResponse['data']['groups'][number]): string;
    formatDetail(group: LogStatsResponse['data']['groups'][number]): string;
    hrefFor(group: LogStatsResponse['data']['groups'][number]): string;
  },
) {
  return [...(stats?.data.groups ?? [])]
    .filter((group) => group.group !== 'unassigned')
    .filter((group) => readGroupCost(group) > 0)
    .sort((left, right) => readGroupCost(right) - readGroupCost(left))
    .map((group) => ({
      label: helpers.formatLabel(group),
      value: formatCost(readGroupCost(group)),
      detail: helpers.formatDetail(group),
      costUsd: readGroupCost(group),
      href: helpers.hrefFor(group),
    }));
}

export function missingSpendPacket(label: string, detail: string) {
  return { label, value: 'Not recorded', detail, href: null };
}

export function stripBreakdownCost<T extends { costUsd: number }>(entry: T): Omit<T, 'costUsd'> {
  const { costUsd: _costUsd, ...packet } = entry;
  return packet;
}

export function sumBreakdownCost(entries: Array<{ costUsd: number }>): number {
  return entries.reduce((total, entry) => total + entry.costUsd, 0);
}

export function readCostFromPacket(value: string): number {
  return Number(value.replace(/[^0-9.]/g, ''));
}
