import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const GRANT_PERMISSION_OPTIONS = ['read', 'write', 'execute'] as const;

interface OrchestratorGrant {
  id: string;
  workflow_id: string;
  agent_id: string;
  permissions: string[];
  expires_at?: string | null;
  created_at: string;
}

interface CreateGrantPayload {
  agent_id: string;
  workflow_id: string;
  permissions: string[];
  expires_at?: string;
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

function normalizeGrants(response: unknown): OrchestratorGrant[] {
  if (Array.isArray(response)) return response as OrchestratorGrant[];
  const wrapped = response as { data?: OrchestratorGrant[] } | undefined;
  return wrapped?.data ?? [];
}

async function fetchGrants(): Promise<OrchestratorGrant[]> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/orchestrator-grants`, {
    headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : undefined,
    credentials: 'include',
  });
  if (!resp.ok) {
    if (resp.status === 404) {
      return [];
    }
    if (resp.status === 403) {
      throw new Error('HTTP 403');
    }
    throw new Error(`HTTP ${resp.status}`);
  }
  return normalizeGrants(await resp.json());
}

async function createGrant(payload: CreateGrantPayload): Promise<OrchestratorGrant> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/orchestrator-grants`, {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  return resp.json();
}

async function revokeGrant(grantId: string): Promise<void> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/orchestrator-grants/${grantId}`, {
    method: 'DELETE',
    headers: session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : undefined,
    credentials: 'include',
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
}

function CreateGrantDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const workflowsQuery = useQuery({
    queryKey: ['workflow-grant-options'],
    queryFn: () => dashboardApi.listWorkflows(),
  });

  const mutation = useMutation({
    mutationFn: createGrant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setAgentId('');
    setWorkflowId('');
    setPermissions([]);
    onClose();
  }

  function togglePermission(permission: string): void {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission],
    );
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (permissions.length === 0 || !agentId.trim() || !workflowId.trim()) return;

    mutation.mutate({
      agent_id: agentId.trim(),
      workflow_id: workflowId.trim(),
      permissions,
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Grant</DialogTitle>
          <DialogDescription>
            Grant orchestrator permissions to an agent or workflow binding.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="grant-agent-id" className="text-sm font-medium">Agent ID</label>
            <Input
              id="grant-agent-id"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="agent-uuid"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Workflow Scope</label>
            <select
              className="flex h-10 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              required
            >
              <option value="">Select workflow</option>
              {(workflowsQuery.data?.data ?? []).map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Permissions</label>
            <div className="flex flex-wrap gap-2">
              {GRANT_PERMISSION_OPTIONS.map((permission) => (
                <Button
                  key={permission}
                  type="button"
                  size="sm"
                  variant={permissions.includes(permission) ? 'default' : 'outline'}
                  onClick={() => togglePermission(permission)}
                >
                  {permission}
                </Button>
              ))}
            </div>
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to create grant. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GrantCards({
  grants,
  onRevoke,
  isRevoking,
}: {
  grants: OrchestratorGrant[];
  onRevoke: (grantId: string) => void;
  isRevoking: boolean;
}): JSX.Element {
  return (
    <div className="grid gap-3 lg:hidden">
      {grants.map((grant) => (
        <div key={grant.id} className="rounded-lg border border-border/70 bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Grant {grant.id.slice(0, 8)}</div>
              <div className="text-xs text-muted-foreground">Created {new Date(grant.created_at).toLocaleString()}</div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={isRevoking}
              onClick={() => onRevoke(grant.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Revoke
            </Button>
          </div>
          <dl className="mt-3 grid gap-3 text-sm">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Agent</dt>
              <dd className="font-mono text-xs break-all">{grant.agent_id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflow</dt>
              <dd className="font-mono text-xs break-all">{grant.workflow_id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permissions</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {grant.permissions.map((perm) => (
                  <Badge key={perm} variant="secondary">{perm}</Badge>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

export function OrchestratorGrantsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['orchestrator-grants'],
    queryFn: fetchGrants,
    retry: false,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeGrant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading orchestrator grants...</div>;
  }

  const isEndpointMissing = error && String(error).includes('404');
  const isPermissionDenied = error && String(error).includes('403');

  if (isEndpointMissing) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Orchestrator Grants</h1>
        </div>
        <div className="rounded-md border border-border bg-border/10 p-6 text-center">
          <p className="text-muted-foreground">
            The orchestrator grants endpoint is not available. This feature requires
            the <code className="text-sm">/api/v1/orchestrator-grants</code> API to be configured.
          </p>
        </div>
      </div>
    );
  }

  if (isPermissionDenied) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Orchestrator Grants</h1>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 p-6 text-center">
          <p className="text-amber-800 dark:text-amber-300">
            Insufficient permissions. Orchestrator grant management requires admin-level access.
            Please log in with an admin API key to manage grants.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load orchestrator grants.</div>;
  }

  const grants = data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Orchestrator Grants</h1>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Create Grant
        </Button>
      </div>

      {grants.length === 0 ? (
        <p className="text-muted-foreground">No orchestrator grants found.</p>
      ) : (
        <>
        <GrantCards
          grants={grants}
          onRevoke={(grantId) => revokeMutation.mutate(grantId)}
          isRevoking={revokeMutation.isPending}
        />
        <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grant ID</TableHead>
              <TableHead>Agent ID</TableHead>
              <TableHead>Workflow ID</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((grant) => (
              <TableRow key={grant.id}>
                <TableCell className="font-mono text-xs" title={grant.id}>
                  {grant.id.length > 12 ? `${grant.id.slice(0, 12)}...` : grant.id}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground" title={grant.agent_id}>
                  {grant.agent_id.length > 12 ? `${grant.agent_id.slice(0, 12)}...` : grant.agent_id}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground" title={grant.workflow_id}>
                  {grant.workflow_id.length > 12 ? `${grant.workflow_id.slice(0, 12)}...` : grant.workflow_id}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {grant.permissions.map((perm) => (
                      <Badge key={perm} variant="secondary">{perm}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(grant.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(grant.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        </>
      )}

      <CreateGrantDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
