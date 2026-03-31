import type { InfiniteData } from '@tanstack/react-query';

import type { DashboardWorkflowRailPacket, DashboardWorkflowRailRow } from '../../lib/api.js';

export function combineWorkflowRailPages(
  data: InfiniteData<DashboardWorkflowRailPacket> | null | undefined,
): DashboardWorkflowRailPacket | null {
  if (!data || data.pages.length === 0) {
    return null;
  }

  const firstPage = data.pages[0];
  const rows = dedupeRailRows(data.pages.flatMap((page) => page.rows));
  const ongoingRows = dedupeRailRows(data.pages.flatMap((page) => page.ongoing_rows));
  const visibleCount = rows.length + ongoingRows.length;

  return {
    ...firstPage,
    rows,
    ongoing_rows: ongoingRows,
    visible_count: visibleCount,
    total_count: firstPage.total_count ?? visibleCount,
    selected_workflow_id:
      firstPage.selected_workflow_id
      ?? rows[0]?.workflow_id
      ?? ongoingRows[0]?.workflow_id
      ?? null,
    next_cursor: getNextWorkflowRailPageParam(data.pages.at(-1) ?? firstPage, data.pages)
      ? `page:${data.pages.length + 1}`
      : null,
  };
}

export function getNextWorkflowRailPageParam(
  lastPage: DashboardWorkflowRailPacket,
  allPages: DashboardWorkflowRailPacket[],
): number | undefined {
  const totalCount = lastPage.total_count ?? 0;
  const loadedCount = allPages.reduce(
    (sum, page) => sum + page.rows.length + page.ongoing_rows.length,
    0,
  );
  return loadedCount < totalCount ? allPages.length + 1 : undefined;
}

function dedupeRailRows(rows: DashboardWorkflowRailRow[]): DashboardWorkflowRailRow[] {
  const seen = new Set<string>();
  const deduped: DashboardWorkflowRailRow[] = [];
  for (const row of rows) {
    if (seen.has(row.workflow_id)) {
      continue;
    }
    seen.add(row.workflow_id);
    deduped.push(row);
  }
  return deduped;
}
