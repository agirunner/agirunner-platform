import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Filter } from 'lucide-react';

import {
  dashboardApi,
  type FleetStatusResponse,
} from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';

interface AgentRecord {
  id: string;
  name: string;
  status: string;
  current_task_id?: string | null;
  worker_id?: string | null;
  capabilities?: string[];
  profile?: Record<string, unknown>;
  last_heartbeat_at?: string | null;
  created_at: string;
}

type StatusFilter = 'all' | 'active' | 'idle' | 'disconnected';
type PoolFilter = 'all' | 'orchestrator' | 'specialist' | 'hybrid';

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  active: 'success',
  idle: 'warning',
  disconnected: 'destructive',
  busy: 'success',
  error: 'destructive',
  inactive: 'secondary',
};

function normalizeAgents(response: unknown): AgentRecord[] {
  if (Array.isArray(response)) {
    return response as AgentRecord[];
  }
  const wrapped = response as { data?: AgentRecord[] } | undefined;
  return wrapped?.data ?? [];
}

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
  return new Date(timestamp).toLocaleString();
}

function readAgentPool(agent: AgentRecord): PoolFilter {
  const executionMode = agent.profile?.execution_mode;
  if (executionMode === 'orchestrator' || executionMode === 'hybrid') {
    return executionMode;
  }
  if (agent.capabilities?.includes('orchestrator')) {
    return 'orchestrator';
  }
  return 'specialist';
}

function matchesStatus(agent: AgentRecord, filter: StatusFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return agent.status.toLowerCase() === filter;
}

function matchesPool(agent: AgentRecord, filter: PoolFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return readAgentPool(agent) === filter;
}

function PoolBadge({ pool }: { pool: PoolFilter }): JSX.Element {
  return (
    <Badge variant={pool === 'orchestrator' ? 'secondary' : pool === 'specialist' ? 'outline' : 'warning'}>
      {pool}
    </Badge>
  );
}

function FleetPoolCards({
  status,
  isLoading,
}: {
  status: FleetStatusResponse | undefined;
  isLoading: boolean;
}): JSX.Element | null {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading pool status...</p>;
  }

  if (!status) {
    return null;
  }

  const orchestratorPool = status.worker_pools.find((pool) => pool.pool_kind === 'orchestrator');
  const specialistPool = status.worker_pools.find((pool) => pool.pool_kind === 'specialist');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PoolCard
        title="Orchestrator Pool"
        pool="orchestrator"
        enabledWorkers={orchestratorPool?.enabled_workers ?? 0}
        runningContainers={orchestratorPool?.running_containers ?? 0}
      />
      <PoolCard
        title="Specialist Pool"
        pool="specialist"
        enabledWorkers={specialistPool?.enabled_workers ?? 0}
        runningContainers={specialistPool?.running_containers ?? 0}
      />
    </div>
  );
}

function PoolCard({
  title,
  pool,
  enabledWorkers,
  runningContainers,
}: {
  title: string;
  pool: 'orchestrator' | 'specialist';
  enabledWorkers: number;
  runningContainers: number;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <PoolBadge pool={pool} />
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-border p-3">
          <p className="text-xl font-semibold">{enabledWorkers}</p>
          <p className="text-xs text-muted-foreground">Enabled workers</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xl font-semibold">{runningContainers}</p>
          <p className="text-xs text-muted-foreground">Running containers</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AgentListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [poolFilter, setPoolFilter] = useState<PoolFilter>('all');

  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => dashboardApi.listAgents(),
  });
  const fleetStatusQuery = useQuery({
    queryKey: ['fleet-status'],
    queryFn: () => dashboardApi.fetchFleetStatus(),
  });

  if (agentsQuery.isLoading) {
    return <div className="p-6 text-muted-foreground">Loading agents...</div>;
  }

  if (agentsQuery.error) {
    return <div className="p-6 text-red-600">Failed to load agents.</div>;
  }

  const allAgents = normalizeAgents(agentsQuery.data);
  const agents = allAgents.filter(
    (agent) => matchesStatus(agent, statusFilter) && matchesPool(agent, poolFilter),
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Agents</h1>
          <Badge variant="secondary" className="ml-2">
            {allAgents.length} total
          </Badge>
        </div>
      </div>

      <FleetPoolCards status={fleetStatusQuery.data} isLoading={fleetStatusQuery.isLoading} />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
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
        <Select value={poolFilter} onValueChange={(value) => setPoolFilter(value as PoolFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by pool" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pools</SelectItem>
            <SelectItem value="orchestrator">Orchestrator</SelectItem>
            <SelectItem value="specialist">Specialist</SelectItem>
            <SelectItem value="hybrid">Hybrid</SelectItem>
          </SelectContent>
        </Select>
        {(statusFilter !== 'all' || poolFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter('all');
              setPoolFilter('all');
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {agents.length === 0 ? (
        <p className="text-muted-foreground">No agents match the current filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pool</TableHead>
              <TableHead>Current Task</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead>Last Heartbeat</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => {
              const pool = readAgentPool(agent);
              return (
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
                    <PoolBadge pool={pool} />
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
                    {formatHeartbeat(agent.last_heartbeat_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
