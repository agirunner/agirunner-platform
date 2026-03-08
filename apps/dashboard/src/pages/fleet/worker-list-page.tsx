import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Server,
  Plus,
  Power,
  PowerOff,
  Activity,
  Cpu,
  Loader2 as Loader2Icon,
  MemoryStick,
  Trash2,
} from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { cn } from '../../lib/utils.js';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/ui/card.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface WorkerBasic {
  id: string;
  name: string;
  status: string;
  capabilities: string[];
  created_at: string;
}

interface FleetWorker {
  id: string;
  name: string;
  status: string;
  role: string;
  cpu_percent: number;
  memory_percent: number;
  current_task_count: number;
  quality_score: number;
  cpu_history: Array<{ t: string; v: number }>;
  memory_history: Array<{ t: string; v: number }>;
}

interface RegisterWorkerPayload {
  name: string;
  role: string;
  endpoint: string;
}

function normalizeWorkers(response: unknown): WorkerBasic[] {
  if (Array.isArray(response)) {
    return response as WorkerBasic[];
  }
  const wrapped = response as { data?: WorkerBasic[] } | undefined;
  return wrapped?.data ?? [];
}

function normalizeFleetWorkers(response: unknown): FleetWorker[] {
  if (Array.isArray(response)) {
    return response as FleetWorker[];
  }
  const wrapped = response as { data?: FleetWorker[] } | undefined;
  return wrapped?.data ?? [];
}

async function fetchFleetWorkers(): Promise<FleetWorker[]> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/workers`, {
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const json = await resp.json();
  return normalizeFleetWorkers(json);
}

async function registerWorker(payload: RegisterWorkerPayload): Promise<unknown> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/workers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

async function drainWorker(workerId: string): Promise<unknown> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/workers/${workerId}/drain`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

async function deleteWorker(workerId: string): Promise<void> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/workers/${workerId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
}

async function restartWorker(workerId: string): Promise<unknown> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/fleet/workers/${workerId}/restart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'warning' | 'secondary'> = {
  online: 'success',
  offline: 'destructive',
  degraded: 'warning',
  busy: 'secondary',
};

function statusVariant(status: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  return STATUS_VARIANT[status.toLowerCase()] ?? 'secondary';
}

function generatePlaceholderHistory(count: number, max: number): Array<{ t: string; v: number }> {
  return Array.from({ length: count }, (_, i) => ({
    t: String(i),
    v: Math.round(Math.random() * max),
  }));
}

function mergeWorkerData(
  basics: WorkerBasic[],
  fleet: FleetWorker[],
): FleetWorker[] {
  const fleetMap = new Map(fleet.map((fw) => [fw.id, fw]));

  const merged: FleetWorker[] = basics.map((basic) => {
    const fw = fleetMap.get(basic.id);
    if (fw) {
      return fw;
    }
    return {
      id: basic.id,
      name: basic.name,
      status: basic.status,
      role: basic.capabilities?.[0] ?? 'general',
      cpu_percent: 0,
      memory_percent: 0,
      current_task_count: 0,
      quality_score: 0,
      cpu_history: generatePlaceholderHistory(8, 100),
      memory_history: generatePlaceholderHistory(8, 100),
    };
  });

  fleet.forEach((fw) => {
    if (!basics.some((b) => b.id === fw.id)) {
      merged.push(fw);
    }
  });

  return merged;
}

function MiniCpuChart({ data }: { data: Array<{ t: string; v: number }> }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <BarChart data={data}>
        <Bar dataKey="v" fill="var(--color-accent, #3b82f6)" radius={[2, 2, 0, 0]} />
        <Tooltip
          contentStyle={{ fontSize: '11px', padding: '2px 6px' }}
          labelStyle={{ display: 'none' }}
          formatter={(value) => [`${Number(value)}%`, 'CPU']}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MiniMemoryChart({ data }: { data: Array<{ t: string; v: number }> }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={40}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke="#8b5cf6"
          fill="url(#memGrad)"
          strokeWidth={1.5}
        />
        <Tooltip
          contentStyle={{ fontSize: '11px', padding: '2px 6px' }}
          labelStyle={{ display: 'none' }}
          formatter={(value) => [`${Number(value)}%`, 'Memory']}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RegisterWorkerDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [endpoint, setEndpoint] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: RegisterWorkerPayload) => registerWorker(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setName('');
    setRole('');
    setEndpoint('');
    onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim() || !role.trim() || !endpoint.trim()) {
      return;
    }
    mutation.mutate({ name: name.trim(), role: role.trim(), endpoint: endpoint.trim() });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register Worker</DialogTitle>
          <DialogDescription>Add a new worker to the fleet.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="worker-name" className="text-sm font-medium">Name</label>
            <Input id="worker-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="worker-01" />
          </div>
          <div className="space-y-2">
            <label htmlFor="worker-role" className="text-sm font-medium">Role</label>
            <Input id="worker-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="code-agent" />
          </div>
          <div className="space-y-2">
            <label htmlFor="worker-endpoint" className="text-sm font-medium">Endpoint</label>
            <Input id="worker-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://worker-01.internal:8443" />
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to register worker. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Registering...' : 'Register'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkerListPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const basicQuery = useQuery({
    queryKey: ['workers'],
    queryFn: () => dashboardApi.listWorkers(),
  });

  const fleetQuery = useQuery({
    queryKey: ['fleet-workers'],
    queryFn: fetchFleetWorkers,
  });

  const drainMutation = useMutation({
    mutationFn: drainWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
    },
  });

  const restartMutation = useMutation({
    mutationFn: restartWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorker,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] });
      queryClient.invalidateQueries({ queryKey: ['fleet-workers'] });
      toast.success('Worker deleted');
    },
    onError: () => {
      toast.error('Failed to delete worker');
    },
  });

  const isLoading = basicQuery.isLoading && fleetQuery.isLoading;
  const hasError = basicQuery.isError && fleetQuery.isError;

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="mt-1 h-3 w-20" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (hasError) {
    return <div className="p-6 text-red-600">Failed to load worker data.</div>;
  }

  const basics = normalizeWorkers(basicQuery.data);
  const fleet = normalizeFleetWorkers(fleetQuery.data);
  const workers = mergeWorkerData(basics, fleet);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Workers</h1>
        </div>
        <Button onClick={() => setIsDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Register Worker
        </Button>
      </div>

      {workers.length === 0 ? (
        <p className="text-muted-foreground">No workers registered.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workers.map((worker) => (
            <Card key={worker.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{worker.name}</CardTitle>
                  <Badge variant={statusVariant(worker.status)} className="capitalize">
                    {worker.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{worker.role}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <Cpu className="h-3 w-3" /> CPU
                    </div>
                    <MiniCpuChart data={worker.cpu_history?.length ? worker.cpu_history : generatePlaceholderHistory(8, 100)} />
                  </div>
                  <div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                      <MemoryStick className="h-3 w-3" /> Memory
                    </div>
                    <MiniMemoryChart data={worker.memory_history?.length ? worker.memory_history : generatePlaceholderHistory(8, 100)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-1">
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Tasks:</span>
                    <span className="font-medium">{worker.current_task_count}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">Quality:</span>
                    <span className={cn('font-medium', worker.quality_score >= 80 ? 'text-green-600' : worker.quality_score >= 50 ? 'text-yellow-600' : 'text-red-600')}>
                      {worker.quality_score}%
                    </span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="gap-2 pt-3 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={drainMutation.isPending}
                  onClick={() => drainMutation.mutate(worker.id)}
                >
                  <PowerOff className="h-3.5 w-3.5" />
                  Drain
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={restartMutation.isPending}
                  onClick={() => restartMutation.mutate(worker.id)}
                >
                  <Power className="h-3.5 w-3.5" />
                  Restart
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(worker.id)}
                  data-testid={`delete-worker-${worker.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <RegisterWorkerDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
    </div>
  );
}
