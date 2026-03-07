import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
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

interface OrchestratorGrant {
  id: string;
  workflow_id?: string | null;
  agent_scope?: string | null;
  agent_id?: string | null;
  permissions: string[];
  created_at: string;
}

interface CreateGrantPayload {
  workflow_id?: string;
  agent_scope?: string;
  permissions: string[];
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.accessToken}`,
  };
}

function normalizeGrants(response: unknown): OrchestratorGrant[] {
  if (Array.isArray(response)) return response as OrchestratorGrant[];
  const wrapped = response as { data?: OrchestratorGrant[] } | undefined;
  return wrapped?.data ?? [];
}

async function fetchGrants(): Promise<OrchestratorGrant[]> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/orchestrator-grants`, {
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    if (resp.status === 404) {
      return [];
    }
    throw new Error(`HTTP ${resp.status}`);
  }
  return normalizeGrants(await resp.json());
}

async function createGrant(payload: CreateGrantPayload): Promise<OrchestratorGrant> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/orchestrator-grants`, {
    method: 'POST',
    headers: authHeaders(),
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
    headers: { Authorization: `Bearer ${session?.accessToken}` },
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
  const [workflowId, setWorkflowId] = useState('');
  const [agentScope, setAgentScope] = useState('');
  const [permissions, setPermissions] = useState('');

  const mutation = useMutation({
    mutationFn: createGrant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orchestrator-grants'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setWorkflowId('');
    setAgentScope('');
    setPermissions('');
    onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const permList = permissions
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (permList.length === 0) return;

    const payload: CreateGrantPayload = { permissions: permList };
    if (workflowId.trim()) payload.workflow_id = workflowId.trim();
    if (agentScope.trim()) payload.agent_scope = agentScope.trim();
    mutation.mutate(payload);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Grant</DialogTitle>
          <DialogDescription>
            Grant orchestrator permissions to an agent or workflow binding.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="grant-workflow" className="text-sm font-medium">Workflow ID</label>
            <Input
              id="grant-workflow"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              placeholder="workflow-uuid"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="grant-agent-scope" className="text-sm font-medium">Agent Scope</label>
            <Input
              id="grant-agent-scope"
              value={agentScope}
              onChange={(e) => setAgentScope(e.target.value)}
              placeholder="e.g. coding, review"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="grant-permissions" className="text-sm font-medium">Permissions (comma-separated)</label>
            <Input
              id="grant-permissions"
              value={permissions}
              onChange={(e) => setPermissions(e.target.value)}
              placeholder="read, write, execute"
            />
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

  if (error) {
    return <div className="p-6 text-red-600">Failed to load orchestrator grants.</div>;
  }

  const grants = data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lock className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Orchestrator Grants</h1>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Grant
        </Button>
      </div>

      {grants.length === 0 ? (
        <p className="text-muted-foreground">No orchestrator grants found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grant ID</TableHead>
              <TableHead>Workflow ID</TableHead>
              <TableHead>Agent Scope</TableHead>
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
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {grant.workflow_id ?? '-'}
                </TableCell>
                <TableCell>
                  {grant.agent_scope ? (
                    <Badge variant="secondary">{grant.agent_scope}</Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
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
      )}

      <CreateGrantDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
