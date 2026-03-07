import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Filter } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '../../components/ui/select.js';

interface Agent {
  id: string;
  name: string;
  status: string;
  current_task_id?: string | null;
  worker_id?: string | null;
  protocol?: string | null;
  last_heartbeat?: string | null;
  role?: string;
  created_at: string;
}

type StatusFilter = 'all' | 'active' | 'idle' | 'disconnected';

function normalizeData(response: unknown): Agent[] {
  if (Array.isArray(response)) {
    return response as Agent[];
  }
  const wrapped = response as { data?: Agent[] } | undefined;
  return wrapped?.data ?? [];
}

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  active: 'success',
  idle: 'warning',
  disconnected: 'destructive',
  busy: 'success',
  error: 'destructive',
  inactive: 'secondary',
};

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  return STATUS_VARIANT[status.toLowerCase()] ?? 'secondary';
}

function truncateId(id: string): string {
  if (id.length <= 12) {
    return id;
  }
  return `${id.slice(0, 8)}...`;
}

function formatHeartbeat(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return '-';
  }
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  return date.toLocaleDateString();
}

function matchesFilter(agent: Agent, filter: StatusFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return agent.status.toLowerCase() === filter;
}

export function AgentListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents'],
    queryFn: () => dashboardApi.listAgents(),
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading agents...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load agents.</div>;
  }

  const allAgents = normalizeData(data);
  const agents = allAgents.filter((agent) => matchesFilter(agent, statusFilter));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Agents</h1>
          <Badge variant="secondary" className="ml-2">{allAgents.length} total</Badge>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="idle">Idle</SelectItem>
            <SelectItem value="disconnected">Disconnected</SelectItem>
          </SelectContent>
        </Select>
        {statusFilter !== 'all' && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
            Clear
          </Button>
        )}
      </div>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">
          {statusFilter !== 'all'
            ? `No agents with status "${statusFilter}".`
            : 'No agents registered.'}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Current Task</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead>Protocol</TableHead>
              <TableHead>Last Heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell className="font-mono text-xs" title={agent.id}>
                  {truncateId(agent.id)}
                </TableCell>
                <TableCell className="font-medium">{agent.name}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(agent.status)} className="capitalize">
                    {agent.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {agent.current_task_id ? (
                    <a
                      href={`/tasks/${agent.current_task_id}`}
                      className="font-mono text-xs text-accent hover:underline"
                      title={agent.current_task_id}
                    >
                      {truncateId(agent.current_task_id)}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {agent.worker_id ? truncateId(agent.worker_id) : '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {agent.protocol ?? '-'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatHeartbeat(agent.last_heartbeat)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
