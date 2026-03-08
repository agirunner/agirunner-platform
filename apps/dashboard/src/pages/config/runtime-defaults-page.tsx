import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Settings2,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
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

interface RuntimeDefault {
  id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface RuntimeDefaultForm {
  configKey: string;
  configValue: string;
  configType: string;
  description: string;
}

const API_BASE_URL =
  import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

const CONFIG_TYPES = ['string', 'number', 'boolean', 'json'] as const;

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

async function fetchDefaults(): Promise<RuntimeDefault[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/runtime-defaults`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createDefault(
  payload: RuntimeDefaultForm,
): Promise<RuntimeDefault> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/runtime-defaults`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function updateDefault(
  id: string,
  payload: Partial<RuntimeDefaultForm>,
): Promise<RuntimeDefault> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/runtime-defaults/${id}`,
    {
      method: 'PATCH',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function deleteDefault(id: string): Promise<void> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/runtime-defaults/${id}`,
    {
      method: 'DELETE',
      headers,
      credentials: 'include',
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const INITIAL_FORM: RuntimeDefaultForm = {
  configKey: '',
  configValue: '',
  configType: 'string',
  description: '',
};

function typeVariant(configType: string) {
  const map: Record<string, 'default' | 'secondary' | 'outline' | 'warning'> = {
    string: 'default',
    number: 'secondary',
    boolean: 'outline',
    json: 'warning',
  };
  return map[configType] ?? ('outline' as const);
}

function CreateDefaultDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<RuntimeDefaultForm>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () => createDefault(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
      toast.success('Runtime default created');
    },
    onError: () => {
      toast.error('Failed to create runtime default');
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)} data-testid="add-runtime-default">
        <Plus className="h-4 w-4" />
        Add Default
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Runtime Default</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Config Key</label>
            <Input
              placeholder="max_retries"
              value={form.configKey}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, configKey: e.target.value }))
              }
              required
              data-testid="config-key-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Config Value</label>
            <Input
              placeholder="3"
              value={form.configValue}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, configValue: e.target.value }))
              }
              required
              data-testid="config-value-input"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Config Type</label>
            <Select
              value={form.configType}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, configType: v }))
              }
            >
              <SelectTrigger data-testid="config-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFIG_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              placeholder="Optional description"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              data-testid="config-description-input"
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
            <Button type="submit" disabled={mutation.isPending} data-testid="submit-runtime-default">
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

function EditDefaultDialog({
  item,
  onClose,
}: {
  item: RuntimeDefault;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    configValue: item.config_value,
    configType: item.config_type,
    description: item.description ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => updateDefault(item.id, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      onClose();
      toast.success('Runtime default updated');
    },
    onError: () => {
      toast.error('Failed to update runtime default');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Runtime Default</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Config Key</label>
            <Input value={item.config_key} disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Config Value</label>
            <Input
              value={form.configValue}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, configValue: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Config Type</label>
            <Select
              value={form.configType}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, configType: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFIG_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
            />
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">{String(mutation.error)}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDefaultDialog({
  item,
  onClose,
}: {
  item: RuntimeDefault;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteDefault(item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      onClose();
      toast.success('Runtime default deleted');
    },
    onError: () => {
      toast.error('Failed to delete runtime default');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Runtime Default</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          Are you sure you want to delete the runtime default &quot;{item.config_key}&quot;?
          This action cannot be undone.
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

function DefaultRow({ item }: { item: RuntimeDefault }): JSX.Element {
  const [editTarget, setEditTarget] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-sm">{item.config_key}</TableCell>
        <TableCell className="font-mono text-sm">{item.config_value}</TableCell>
        <TableCell>
          <Badge variant={typeVariant(item.config_type)}>{item.config_type}</Badge>
        </TableCell>
        <TableCell className="text-sm text-muted">
          {item.description ?? '-'}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setEditTarget(true)}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setDeleteTarget(true)}
              title="Delete"
              data-testid={`delete-default-${item.config_key}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {editTarget && (
        <EditDefaultDialog item={item} onClose={() => setEditTarget(false)} />
      )}
      {deleteTarget && (
        <DeleteDefaultDialog item={item} onClose={() => setDeleteTarget(false)} />
      )}
    </>
  );
}

export function RuntimeDefaultsPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['runtime-defaults'],
    queryFn: fetchDefaults,
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
          Failed to load runtime defaults: {String(error)}
        </div>
      </div>
    );
  }

  const defaults = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Runtime Defaults</h1>
          <p className="text-sm text-muted">
            Manage default configuration values for worker runtimes.
          </p>
        </div>
        <CreateDefaultDialog />
      </div>

      {defaults.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <Settings2 className="h-12 w-12 mb-4" />
          <p className="font-medium">No runtime defaults configured</p>
          <p className="text-sm mt-1">
            Add a runtime default to set baseline configuration values.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {defaults.map((item) => (
              <DefaultRow key={item.id} item={item} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
