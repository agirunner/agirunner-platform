import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  OperatorStatusBadge,
  RelativeTimestamp,
  formatOperatorStatusLabel,
} from '../../components/operator-display.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import {
  formatContainerKindLabel,
  isPendingChangeRow,
  isRecentlyChangedRow,
  type SessionContainerRow,
} from './containers-page.support.js';

export function ContainersTable(props: {
  rows: SessionContainerRow[];
  emptyMessage: string;
}): JSX.Element {
  if (props.rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-surface/80 px-4 py-8 text-sm text-muted-foreground">
        {props.emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-surface/90 shadow-sm">
      <Table className="min-w-[1240px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Status</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Playbook</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>Memory</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Last activity</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <TableRow key={row.id} className={resolveRowClassName(row)}>
              <TableCell className="min-w-36 py-3">
                <div className="space-y-1">
                  <OperatorStatusBadge status={row.presence === 'inactive' ? 'inactive' : row.state} />
                  <p className="text-xs text-muted-foreground">
                    {row.presence === 'inactive'
                      ? 'No longer reported by the platform API'
                      : `${formatOperatorStatusLabel(row.activity_state ?? row.state)} • ${row.status}`}
                  </p>
                </div>
              </TableCell>
              <TableCell className="min-w-40 py-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{formatContainerKindLabel(row.kind)}</p>
                  <p className="text-xs text-muted-foreground">{row.name}</p>
                </div>
              </TableCell>
              <TableCell className="min-w-28 py-3">
                <span className="text-sm text-foreground">{row.role_name ?? 'Unassigned'}</span>
              </TableCell>
              <TableCell className="min-w-40 py-3">
                <CellText>{row.playbook_name ?? '-'}</CellText>
              </TableCell>
              <TableCell className="min-w-48 py-3">
                {renderEntityLink(row.workflow_id, row.workflow_name, '/work/boards')}
              </TableCell>
              <TableCell className="min-w-32 py-3">
                <CellText>{row.stage_name ?? '-'}</CellText>
              </TableCell>
              <TableCell className="min-w-56 py-3">
                {renderEntityLink(row.task_id, row.task_title, '/work/tasks')}
              </TableCell>
              <TableCell className="min-w-64 py-3">
                <code className="block truncate text-xs text-foreground" title={row.image}>
                  {row.image}
                </code>
              </TableCell>
              <TableCell className="min-w-24 py-3">
                <CellText>{formatLimit(row.cpu_limit)}</CellText>
              </TableCell>
              <TableCell className="min-w-24 py-3">
                <CellText>{formatLimit(row.memory_limit)}</CellText>
              </TableCell>
              <TableCell className="min-w-28 py-3">
                <RelativeTimestamp value={row.started_at ?? row.last_seen_at} />
              </TableCell>
              <TableCell className="min-w-28 py-3">
                <RelativeTimestamp value={row.inactive_at ?? row.last_seen_at} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CellText(props: { children: ReactNode }): JSX.Element {
  return <span className="block text-sm text-foreground">{props.children}</span>;
}

function renderEntityLink(id: string | null, label: string | null, hrefBase: string): ReactNode {
  if (!id) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
  return (
    <Link className="text-sm text-accent hover:underline" to={`${hrefBase}/${id}`}>
      {label ?? id}
    </Link>
  );
}

function formatLimit(value: string | null): string {
  return value?.trim() ? value : 'Docker default';
}

function resolveRowClassName(row: SessionContainerRow): string {
  if (isPendingChangeRow(row)) {
    return 'bg-success/8 ring-1 ring-inset ring-success/20 hover:bg-success/12';
  }
  const recentlyChanged = isRecentlyChangedRow(row);
  if (row.presence === 'inactive') {
    return recentlyChanged
      ? 'bg-warning/14 ring-1 ring-inset ring-warning/25 hover:bg-warning/18'
      : 'bg-muted/8 hover:bg-muted/14';
  }
  return recentlyChanged
    ? 'bg-success/14 ring-1 ring-inset ring-success/25 hover:bg-success/18'
    : 'hover:bg-background/60';
}
