import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { dashboardApi, type DashboardAuditLogRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';

const PAGE_SIZE = 25;

const ACTION_VARIANT: Record<string, 'default' | 'success' | 'destructive' | 'warning' | 'secondary'> = {
  create: 'success',
  delete: 'destructive',
  update: 'warning',
  revoke: 'destructive',
  approve: 'success',
  reject: 'destructive',
};

function actionVariant(action: string): 'default' | 'success' | 'destructive' | 'warning' | 'secondary' {
  const key = action.toLowerCase().split('.')[0] ?? '';
  return ACTION_VARIANT[key] ?? 'secondary';
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

function buildFilters(
  dateFrom: string,
  dateTo: string,
  actor: string,
  action: string,
  resourceType: string,
  page: number,
): Record<string, string> {
  const filters: Record<string, string> = {};
  if (dateFrom) filters.from = dateFrom;
  if (dateTo) filters.to = dateTo;
  if (actor.trim()) filters.actor = actor.trim();
  if (action && action !== 'all') filters.action = action;
  if (resourceType.trim()) filters.resource_type = resourceType.trim();
  filters.page = String(page);
  filters.per_page = String(PAGE_SIZE);
  return filters;
}

function exportToCsv(entries: DashboardAuditLogRecord[]): void {
  const header = 'Timestamp,Actor,Action,Resource Type,Resource ID,Details';
  const rows = entries.map((entry) => {
    const details = entry.details ? JSON.stringify(entry.details).replace(/"/g, '""') : '';
    return [
      entry.created_at,
      entry.actor_id ?? entry.actor_type,
      entry.action,
      entry.resource_type,
      entry.resource_id ?? '',
      `"${details}"`,
    ].join(',');
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function ExpandableDetails({ details }: { details?: Record<string, unknown> }): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!details || Object.keys(details).length === 0) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1 text-xs"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {isExpanded ? 'Hide' : 'Show'}
      </Button>
      {isExpanded && (
        <pre className="mt-1 max-w-xs overflow-auto rounded bg-border/20 p-2 text-xs">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLogPage(): JSX.Element {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actor, setActor] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resourceType, setResourceType] = useState('');
  const [page, setPage] = useState(1);

  const filters = buildFilters(dateFrom, dateTo, actor, actionFilter, resourceType, page);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => dashboardApi.listAuditLogs(filters),
  });

  const entries: DashboardAuditLogRecord[] = data?.data ?? [];
  const pagination = data?.pagination as { total?: number; page?: number; per_page?: number } | undefined;
  const totalPages = pagination?.total ? Math.ceil(pagination.total / PAGE_SIZE) : undefined;

  const handleExport = useCallback(() => {
    exportToCsv(entries);
  }, [entries]);

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading audit logs...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load audit logs.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Audit Log</h1>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={entries.length === 0}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="date-from" className="text-xs font-medium text-muted-foreground">From</label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="date-to" className="text-xs font-medium text-muted-foreground">To</label>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="actor-filter" className="text-xs font-medium text-muted-foreground">Actor</label>
          <Input
            id="actor-filter"
            value={actor}
            onChange={(e) => { setActor(e.target.value); setPage(1); }}
            placeholder="Filter by actor"
            className="w-48"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Action</label>
          <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
              <SelectItem value="approve">Approve</SelectItem>
              <SelectItem value="reject">Reject</SelectItem>
              <SelectItem value="revoke">Revoke</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="resource-type-filter" className="text-xs font-medium text-muted-foreground">Resource Type</label>
          <Input
            id="resource-type-filter"
            value={resourceType}
            onChange={(e) => { setResourceType(e.target.value); setPage(1); }}
            placeholder="e.g. task, workflow"
            className="w-48"
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground">No audit log entries found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource Type</TableHead>
              <TableHead>Resource ID</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatTimestamp(entry.created_at)}
                </TableCell>
                <TableCell className="font-medium">
                  {entry.actor_id ?? entry.actor_type}
                </TableCell>
                <TableCell>
                  <Badge variant={actionVariant(entry.action)}>
                    {entry.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{entry.resource_type}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {entry.resource_id ?? '-'}
                </TableCell>
                <TableCell>
                  <ExpandableDetails details={entry.details} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {page}{totalPages ? ` of ${totalPages}` : ''}
          {pagination?.total ? ` (${pagination.total} entries)` : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
