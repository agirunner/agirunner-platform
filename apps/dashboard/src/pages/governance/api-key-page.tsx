import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Key, Plus, Copy, Check } from 'lucide-react';
import { dashboardApi, type DashboardApiKeyRecord } from '../../lib/api.js';
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

const SCOPE_VARIANT: Record<string, 'default' | 'success' | 'destructive' | 'warning' | 'secondary'> = {
  admin: 'destructive',
  worker: 'warning',
  agent: 'success',
};

function scopeVariant(scope: string): 'default' | 'success' | 'destructive' | 'warning' | 'secondary' {
  return SCOPE_VARIANT[scope.toLowerCase()] ?? 'secondary';
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
}

function formatLastUsed(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function CreateApiKeyDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'agent' | 'worker' | 'admin'>('agent');
  const [label, setLabel] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: (payload: { scope: 'agent' | 'worker' | 'admin'; label: string; expires_at: string }) =>
      dashboardApi.createApiKey({
        scope: payload.scope,
        owner_type: 'user',
        label: payload.label || undefined,
        expires_at: payload.expires_at,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setCreatedKey(data.api_key);
    },
  });

  function resetForm(): void {
    setScope('agent');
    setLabel('');
    setExpiryDate('');
    setCreatedKey(null);
    setHasCopied(false);
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!expiryDate) return;
    mutation.mutate({
      scope,
      label: label.trim(),
      expires_at: new Date(expiryDate).toISOString(),
    });
  }

  async function handleCopy(): Promise<void> {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{createdKey ? 'API Key Created' : 'Create API Key'}</DialogTitle>
          <DialogDescription>
            {createdKey
              ? 'Copy this key now. It will not be shown again.'
              : 'Generate a new API key with a specific scope and expiry.'}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-border bg-border/10 p-3">
              <code className="flex-1 break-all text-sm font-mono">{createdKey}</code>
              <Button variant="ghost" size="icon" onClick={handleCopy}>
                {hasCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Scope</label>
              <Select value={scope} onValueChange={(v) => setScope(v as 'agent' | 'worker' | 'admin')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label htmlFor="key-label" className="text-sm font-medium">Label</label>
              <Input
                id="key-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="my-api-key"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="key-expiry" className="text-sm font-medium">Expiry Date</label>
              <Input
                id="key-expiry"
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </div>
            {mutation.isError && (
              <p className="text-sm text-red-600">Failed to create API key. Please try again.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={mutation.isPending || !expiryDate}>
                {mutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeConfirmDialog({
  isOpen,
  onClose,
  keyId,
  keyPrefix,
}: {
  isOpen: boolean;
  onClose: () => void;
  keyId: string;
  keyPrefix: string;
}): JSX.Element {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => dashboardApi.revokeApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      onClose();
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke API Key</DialogTitle>
          <DialogDescription>
            Are you sure you want to revoke key &quot;{keyPrefix}...&quot;? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {mutation.isError && (
          <p className="text-sm text-red-600">Failed to revoke key. Please try again.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Revoking...' : 'Revoke'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeyPage(): JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; prefix: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => dashboardApi.listApiKeys(),
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Loading API keys...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-600">Failed to load API keys.</div>;
  }

  const apiKeys: DashboardApiKeyRecord[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold">API Keys</h1>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create API Key
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <p className="text-muted-foreground">No API keys found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key Prefix</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-mono text-xs">{key.key_prefix}...</TableCell>
                <TableCell>
                  <Badge variant={scopeVariant(key.scope)} className="capitalize">
                    {key.scope}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {key.owner_id ?? key.owner_type}
                </TableCell>
                <TableCell className="text-muted-foreground">{key.label ?? '-'}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastUsed(key.last_used_at)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(key.expires_at)}
                </TableCell>
                <TableCell>
                  <Badge variant={key.is_revoked ? 'destructive' : 'success'}>
                    {key.is_revoked ? 'Revoked' : 'Active'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {!key.is_revoked && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRevokeTarget({ id: key.id, prefix: key.key_prefix })}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateApiKeyDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />

      {revokeTarget && (
        <RevokeConfirmDialog
          isOpen={true}
          onClose={() => setRevokeTarget(null)}
          keyId={revokeTarget.id}
          keyPrefix={revokeTarget.prefix}
        />
      )}
    </div>
  );
}
