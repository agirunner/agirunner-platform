import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  CopyableIdBadge,
  OperatorStatusBadge,
  RelativeTimestamp,
  formatOperatorStatusLabel,
} from '../../components/operator-display.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import {
  formatContainerKindLabel,
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
      <Table className="min-w-[1320px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Status</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Container</TableHead>
            <TableHead>Task role</TableHead>
            <TableHead>Playbook</TableHead>
            <TableHead>Workflow</TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>CPU</TableHead>
            <TableHead>Memory</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Last seen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="min-w-40">
                <div className="space-y-2">
                  <OperatorStatusBadge status={row.presence === 'inactive' ? 'inactive' : row.state} />
                  <p className="text-xs text-muted-foreground">
                    {row.presence === 'inactive'
                      ? 'No longer reported by the platform API'
                      : `${formatOperatorStatusLabel(row.activity_state ?? row.state)} • ${row.status}`}
                  </p>
                </div>
              </TableCell>
              <TableCell className="min-w-36">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{formatContainerKindLabel(row.kind)}</p>
                  <p className="text-xs text-muted-foreground">{row.name}</p>
                </div>
              </TableCell>
              <TableCell className="min-w-44">
                <CopyableIdBadge value={row.container_id} />
              </TableCell>
              <TableCell className="min-w-28">
                <span className="text-sm text-foreground">{row.role_name ?? 'Unassigned'}</span>
              </TableCell>
              <TableCell className="min-w-40">
                <CellText>{row.playbook_name ?? '-'}</CellText>
              </TableCell>
              <TableCell className="min-w-48">
                {renderEntityLink(row.workflow_id, row.workflow_name, '/work/boards')}
              </TableCell>
              <TableCell className="min-w-56">
                {renderEntityLink(row.task_id, row.task_title, '/work/tasks')}
              </TableCell>
              <TableCell className="min-w-64">
                <code className="block truncate text-xs text-foreground" title={row.image}>
                  {row.image}
                </code>
              </TableCell>
              <TableCell className="min-w-24">
                <CellText>{formatLimit(row.cpu_limit)}</CellText>
              </TableCell>
              <TableCell className="min-w-24">
                <CellText>{formatLimit(row.memory_limit)}</CellText>
              </TableCell>
              <TableCell className="min-w-28">
                <RelativeTimestamp value={row.started_at ?? row.last_seen_at} />
              </TableCell>
              <TableCell className="min-w-28">
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
