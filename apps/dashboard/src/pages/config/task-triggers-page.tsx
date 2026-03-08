import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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

interface TaskTriggerRecord {
  id: string;
  name: string;
  source: string;
  project_id?: string | null;
  workflow_id?: string | null;
  signature_header: string;
  signature_mode: string;
  is_active: boolean;
  created_at?: string;
}

interface CreateTriggerForm {
  name: string;
  source: string;
  project_id: string;
  workflow_id: string;
  signature_header: string;
  signature_mode: string;
  secret: string;
}

const API_BASE_URL =
  import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchTriggers(): Promise<TaskTriggerRecord[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/task-triggers`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createTrigger(
  payload: Record<string, unknown>,
): Promise<TaskTriggerRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/task-triggers`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function deleteTrigger(id: string): Promise<void> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/task-triggers/${id}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function updateTriggerActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/task-triggers/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify({ is_active: isActive }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const INITIAL_FORM: CreateTriggerForm = {
  name: '',
  source: '',
  project_id: '',
  workflow_id: '',
  signature_header: 'X-Signature',
  signature_mode: 'hmac_sha256',
  secret: '',
};

function CreateTriggerDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<CreateTriggerForm>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        source: form.source,
        signature_header: form.signature_header,
        signature_mode: form.signature_mode,
        secret: form.secret,
      };
      if (form.project_id) payload.project_id = form.project_id;
      if (form.workflow_id) payload.workflow_id = form.workflow_id;
      return createTrigger(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-triggers'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
      toast.success('Task trigger created');
    },
    onError: () => {
      toast.error('Failed to create task trigger');
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)} data-testid="add-task-trigger">
        <Plus className="h-4 w-4" />
        Add Trigger
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Task Trigger</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              placeholder="GitHub Push Trigger"
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              required
              data-testid="trigger-name-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Source</label>
            <Input
              placeholder="github"
              value={form.source}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, source: e.target.value }))
              }
              required
              data-testid="trigger-source-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Project ID (optional)
            </label>
            <Input
              placeholder="project-uuid"
              value={form.project_id}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, project_id: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Workflow ID (optional)
            </label>
            <Input
              placeholder="workflow-uuid"
              value={form.workflow_id}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, workflow_id: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Signature Header</label>
            <Input
              placeholder="X-Signature"
              value={form.signature_header}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, signature_header: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Signature Mode</label>
            <Select
              value={form.signature_mode}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, signature_mode: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hmac_sha256">HMAC SHA256</SelectItem>
                <SelectItem value="shared_secret">Shared Secret</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Secret (min 8 chars)</label>
            <Input
              type="password"
              placeholder="secret-key"
              value={form.secret}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, secret: e.target.value }))
              }
              required
              data-testid="trigger-secret-input"
            />
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">{String(mutation.error)}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="submit-trigger">
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteTriggerDialog({
  triggerId,
  onClose,
}: {
  triggerId: string;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteTrigger(triggerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-triggers'] });
      onClose();
      toast.success('Task trigger deleted');
    },
    onError: () => {
      toast.error('Failed to delete task trigger');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Task Trigger</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          Are you sure you want to delete this task trigger? This action cannot be undone.
        </p>
        {mutation.error && (
          <p className="text-sm text-red-600">{String(mutation.error)}</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="confirm-delete"
          >
            {mutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TriggerRow({
  trigger,
}: {
  trigger: TaskTriggerRecord;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: (checked: boolean) =>
      updateTriggerActive(trigger.id, checked),
    onSuccess: (_data, checked) => {
      queryClient.invalidateQueries({ queryKey: ['task-triggers'] });
      toast.success(checked ? 'Trigger enabled' : 'Trigger disabled');
    },
    onError: () => {
      toast.error('Failed to update trigger');
    },
  });

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{trigger.name}</TableCell>
        <TableCell className="text-sm text-muted">{trigger.source}</TableCell>
        <TableCell>
          <Badge variant="outline">{trigger.signature_mode}</Badge>
        </TableCell>
        <TableCell>
          <Switch
            checked={trigger.is_active}
            onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            disabled={toggleMutation.isPending}
          />
        </TableCell>
        <TableCell>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setDeleteTarget(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>
      {deleteTarget && (
        <DeleteTriggerDialog
          triggerId={trigger.id}
          onClose={() => setDeleteTarget(false)}
        />
      )}
    </>
  );
}

export function TaskTriggersPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['task-triggers'],
    queryFn: fetchTriggers,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load task triggers: {String(error)}
        </div>
      </div>
    );
  }

  const triggers = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Task Triggers</h1>
          <p className="text-sm text-muted">
            Manage webhook-based triggers that automatically create tasks.
          </p>
        </div>
        <CreateTriggerDialog />
      </div>

      {triggers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <Zap className="h-12 w-12 mb-4" />
          <p className="font-medium">No task triggers configured</p>
          <p className="text-sm mt-1">
            Add a trigger to automatically create tasks from webhook events.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Signature Mode</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {triggers.map((trigger) => (
              <TriggerRow key={trigger.id} trigger={trigger} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
