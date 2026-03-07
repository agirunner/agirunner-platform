import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Plus, X } from 'lucide-react';
import { dashboardApi } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface LegalHold {
  entity_type: 'task' | 'workflow';
  entity_id: string;
  held: boolean;
  created_at?: string;
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.accessToken}`,
  };
}

async function fetchLegalHolds(): Promise<LegalHold[]> {
  const session = readSession();
  const resp = await fetch(`${API_BASE_URL}/api/v1/governance/legal-holds`, {
    headers: { Authorization: `Bearer ${session?.accessToken}` },
  });
  if (!resp.ok) {
    if (resp.status === 404) {
      return [];
    }
    throw new Error(`HTTP ${resp.status}`);
  }
  const json = await resp.json();
  if (Array.isArray(json)) return json;
  if (json?.data && Array.isArray(json.data)) return json.data;
  return [];
}

function CreateHoldDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<'task' | 'workflow'>('task');
  const [entityId, setEntityId] = useState('');

  const mutation = useMutation({
    mutationFn: ({ type, id }: { type: 'task' | 'workflow'; id: string }) => {
      if (type === 'task') {
        return dashboardApi.setTaskLegalHold(id, true);
      }
      return dashboardApi.setWorkflowLegalHold(id, true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal-holds'] });
      resetAndClose();
    },
  });

  function resetAndClose(): void {
    setEntityType('task');
    setEntityId('');
    onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!entityId.trim()) return;
    mutation.mutate({ type: entityType, id: entityId.trim() });
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Legal Hold</DialogTitle>
          <DialogDescription>
            Place a legal hold on a task or workflow to prevent deletion.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Entity Type</label>
            <Select value={entityType} onValueChange={(v) => setEntityType(v as 'task' | 'workflow')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task">Task</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label htmlFor="entity-id" className="text-sm font-medium">Entity ID</label>
            <Input
              id="entity-id"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="Enter task or workflow ID"
            />
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Failed to create legal hold. Please try again.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !entityId.trim()}>
              {mutation.isPending ? 'Creating...' : 'Create Hold'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseHoldButton({ hold }: { hold: LegalHold }): JSX.Element {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      if (hold.entity_type === 'task') {
        return dashboardApi.setTaskLegalHold(hold.entity_id, false);
      }
      return dashboardApi.setWorkflowLegalHold(hold.entity_id, false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal-holds'] });
    },
  });

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <X className="h-3.5 w-3.5" />
      {mutation.isPending ? 'Releasing...' : 'Release'}
    </Button>
  );
}

export function LegalHoldsPage(): JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['legal-holds'],
    queryFn: fetchLegalHolds,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading legal holds...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load legal holds.</div>;
  }

  const holds = (data ?? []).filter((h) => h.held);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">Legal Holds</h1>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Hold
        </Button>
      </div>

      {holds.length === 0 ? (
        <p className="text-muted-foreground">No active legal holds.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity Type</TableHead>
              <TableHead>Entity ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holds.map((hold) => (
              <TableRow key={`${hold.entity_type}-${hold.entity_id}`}>
                <TableCell>
                  <Badge variant="secondary" className="capitalize">{hold.entity_type}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{hold.entity_id}</TableCell>
                <TableCell>
                  <Badge variant="warning">Held</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {hold.created_at ? new Date(hold.created_at).toLocaleString() : '-'}
                </TableCell>
                <TableCell>
                  <ReleaseHoldButton hold={hold} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateHoldDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
    </div>
  );
}
