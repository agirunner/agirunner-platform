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
  hasPendingField,
  hasRecentlyChangedField,
  type ContainerDiffField,
  type SessionContainerRow,
} from './containers-page.support.js';

const TABLE_COLUMN_CLASS_NAMES = [
  'w-[12rem]',
  'w-[12rem]',
  'w-[8rem]',
  'w-[11rem]',
  'w-[14rem]',
  'w-[8rem]',
  'w-[16rem]',
  'w-[18rem]',
  'w-[6rem]',
  'w-[7rem]',
  'w-[8rem]',
  'w-[8rem]',
] as const;

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
      <Table className="min-w-[1240px] table-fixed">
        <colgroup>
          {TABLE_COLUMN_CLASS_NAMES.map((className) => (
            <col key={className} className={className} />
          ))}
        </colgroup>
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
              <DiffCell row={row} field="status" className="py-3">
                <div className="space-y-1">
                  <OperatorStatusBadge status={row.presence === 'inactive' ? 'inactive' : row.state} />
                  <p className="text-xs text-muted-foreground">
                    {row.presence === 'inactive'
                      ? 'No longer reported by the platform API'
                      : `${formatOperatorStatusLabel(row.activity_state ?? row.state)} • ${row.status}`}
                  </p>
                </div>
              </DiffCell>
              <DiffCell row={row} field="kind" className="py-3">
                <p className="font-medium text-foreground">{formatContainerKindLabel(row.kind)}</p>
              </DiffCell>
              <DiffCell row={row} field="role" className="py-3">
                <CellText>{sanitizeContainerContextLabel(row.role_name)}</CellText>
              </DiffCell>
              <DiffCell row={row} field="playbook" className="py-3">
                <CellText>{sanitizeContainerContextLabel(row.playbook_name)}</CellText>
              </DiffCell>
              <DiffCell row={row} field="workflow" className="py-3">
                {renderEntityLink(row.workflow_id, row.workflow_name, '/work/boards')}
              </DiffCell>
              <DiffCell row={row} field="stage" className="py-3">
                <CellText>{row.stage_name ?? '-'}</CellText>
              </DiffCell>
              <DiffCell row={row} field="task" className="py-3">
                {renderEntityLink(row.task_id, row.task_title, '/work/tasks')}
              </DiffCell>
              <DiffCell row={row} field="image" className="py-3">
                <code className="block truncate text-xs text-foreground" title={row.image}>
                  {row.image}
                </code>
              </DiffCell>
              <DiffCell row={row} field="cpu" className="py-3">
                <CellText>{formatLimit(row.cpu_limit)}</CellText>
              </DiffCell>
              <DiffCell row={row} field="memory" className="py-3">
                <CellText>{formatLimit(row.memory_limit)}</CellText>
              </DiffCell>
              <DiffCell row={row} field="started" className="py-3">
                <RelativeTimestamp value={row.started_at ?? row.last_seen_at} />
              </DiffCell>
              <TableCell className="py-3">
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

function sanitizeContainerContextLabel(value: string | null): string {
  return isSyntheticContainerContextLabel(value) ? '-' : (value?.trim() || '-');
}

function DiffCell(props: {
  row: SessionContainerRow;
  field: ContainerDiffField;
  className: string;
  children: ReactNode;
}): JSX.Element {
  const toneClassName = resolveDiffCellTone(props.row, props.field);
  if (!toneClassName) {
    return <TableCell className={props.className}>{props.children}</TableCell>;
  }

  return (
    <TableCell className={props.className}>
      <div className={`${toneClassName} -mx-2 -my-1 rounded-md px-2 py-1`}>
        {props.children}
      </div>
    </TableCell>
  );
}

function renderEntityLink(id: string | null, label: string | null, hrefBase: string): ReactNode {
  if (isSyntheticContainerContextLabel(label)) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }
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

function isSyntheticContainerContextLabel(value: string | null): boolean {
  return value?.trim().toLowerCase() === 'specialist runtimes';
}

function resolveRowClassName(row: SessionContainerRow): string {
  return row.presence === 'inactive' ? 'bg-muted/6 italic hover:bg-muted/10' : 'hover:bg-background/60';
}

function resolveDiffCellTone(row: SessionContainerRow, field: ContainerDiffField): string {
  if (hasPendingField(row, field)) {
    return 'bg-success/10 ring-1 ring-inset ring-success/20';
  }
  if (!hasRecentlyChangedField(row, field)) {
    return '';
  }
  if (field === 'status' && row.presence === 'inactive') {
    return 'bg-warning/14 ring-1 ring-inset ring-warning/25';
  }
  return 'bg-success/14 ring-1 ring-inset ring-success/25';
}
