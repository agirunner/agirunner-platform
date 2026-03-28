import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Key, Loader2, Plus, ShieldAlert } from 'lucide-react';

import { dashboardApi, type DashboardApiKeyRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
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

type ApiKeyScope = 'agent' | 'worker' | 'admin';
type ApiKeyOwnerType = 'user' | 'agent' | 'worker';

const OWNER_OPTIONS: ApiKeyOwnerType[] = ['user', 'agent', 'worker'];
const SCOPE_VARIANT: Record<ApiKeyScope, 'success' | 'warning' | 'destructive'> = {
  agent: 'success',
  worker: 'warning',
  admin: 'destructive',
};
const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  agent: 'Specialist Execution',
  worker: 'Specialist Agent',
  admin: 'Admin',
};
const OWNER_LABELS: Record<ApiKeyOwnerType, string> = {
  user: 'User',
  agent: 'Specialist Execution',
  worker: 'Specialist Agent',
};

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function formatRelativeLastUsed(value: string | null): string {
  if (!value) {
    return 'Never used';
  }
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) {
    return 'Used today';
  }
  if (diffDays === 1) {
    return 'Used yesterday';
  }
  if (diffDays < 30) {
    return `Used ${diffDays}d ago`;
  }
  return `Used ${date.toLocaleDateString()}`;
}

function CreateApiKeyDialog(props: {
  isOpen: boolean;
  onClose(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<ApiKeyScope>('agent');
  const [ownerType, setOwnerType] = useState<ApiKeyOwnerType>('user');
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState(() => {
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return nextWeek.toISOString().slice(0, 10);
  });
  const [hasAttemptedCreateSubmit, setHasAttemptedCreateSubmit] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      dashboardApi.createApiKey({
        scope,
        owner_type: ownerType,
        label: label.trim() || undefined,
        expires_at: new Date(`${expiresAt}T00:00:00.000Z`).toISOString(),
      }),
    onSuccess: async (data) => {
      setCreatedKey(data.api_key);
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  function resetAndClose(): void {
    setScope('agent');
    setOwnerType('user');
    setLabel('');
    setHasAttemptedCreateSubmit(false);
    setHasCopied(false);
    setCreatedKey(null);
    props.onClose();
  }

  async function handleCopy(): Promise<void> {
    if (!createdKey) {
      return;
    }
    await navigator.clipboard.writeText(createdKey);
    setHasCopied(true);
    window.setTimeout(() => setHasCopied(false), 2000);
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => (!open ? resetAndClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{createdKey ? 'API Key Created' : 'Create API Key'}</DialogTitle>
          <DialogDescription>
            {createdKey
              ? 'Copy this key now. It will not be shown again once you close the dialog.'
              : 'Create a scoped API key with an explicit owner type and expiry.'}
          </DialogDescription>
        </DialogHeader>
        {createdKey ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-surface/80 p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-500" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Treat this key like a password.</p>
                  <p className="break-all font-mono text-xs text-muted">{createdKey}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => void handleCopy()}>
                {hasCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {hasCopied ? 'Copied' : 'Copy'}
              </Button>
              <Button onClick={resetAndClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!expiresAt) {
                setHasAttemptedCreateSubmit(true);
                return;
              }
              createMutation.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Scope</span>
                <Select value={scope} onValueChange={(value) => setScope(value as ApiKeyScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Specialist Execution</SelectItem>
                    <SelectItem value="worker">Specialist Agent</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Owner type</span>
                <Select
                  value={ownerType}
                  onValueChange={(value) => setOwnerType(value as ApiKeyOwnerType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OWNER_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {OWNER_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Label</span>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Production operator key"
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Expiry date</span>
              <Input
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                aria-invalid={Boolean(hasAttemptedCreateSubmit && !expiresAt)}
              />
              {hasAttemptedCreateSubmit && !expiresAt ? (
                <span className="text-xs text-red-600 dark:text-red-400">
                  Select an expiry date.
                </span>
              ) : null}
            </label>
            {createMutation.isError ? (
              <p className="text-sm text-red-600">Failed to create API key.</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Create
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RevokeApiKeyDialog(props: {
  keyRecord: DashboardApiKeyRecord | null;
  onClose(): void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!props.keyRecord) {
        throw new Error('Missing key target.');
      }
      return dashboardApi.revokeApiKey(props.keyRecord.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      props.onClose();
    },
  });

  return (
    <Dialog open={Boolean(props.keyRecord)} onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke API Key</DialogTitle>
          <DialogDescription>
            Revoke {props.keyRecord?.key_prefix}... immediately. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {revokeMutation.isError ? (
          <p className="text-sm text-red-600">Failed to revoke API key.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate()}
          >
            {revokeMutation.isPending ? 'Revoking...' : 'Revoke'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ApiKeyManagementPage(): JSX.Element {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DashboardApiKeyRecord | null>(null);

  const keysQuery = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => dashboardApi.listApiKeys(),
  });

  const activeCount = useMemo(
    () => (keysQuery.data ?? []).filter((key) => !key.is_revoked).length,
    [keysQuery.data],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Key className="h-6 w-6 text-muted" />
            <h1 className="text-2xl font-semibold">API Keys</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted">
            Create scoped platform keys, review recent usage, and revoke stale credentials without
            leaving the dashboard.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create API Key
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Issued Keys</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {(keysQuery.data ?? []).length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active Keys</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{activeCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revoked Keys</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {(keysQuery.data ?? []).length - activeCount}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issued Keys</CardTitle>
          <CardDescription>
            Review active credentials, their scope, and revoke keys that are no longer needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keysQuery.isLoading ? <p className="text-sm text-muted">Loading keys...</p> : null}
          {keysQuery.error ? <p className="text-sm text-red-600">Failed to load keys.</p> : null}
          {!keysQuery.isLoading && !keysQuery.error ? (
            keysQuery.data && keysQuery.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prefix</TableHead>
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
                  {keysQuery.data.map((apiKey) => (
                    <TableRow key={apiKey.id}>
                      <TableCell className="font-mono text-xs">{apiKey.key_prefix}...</TableCell>
                      <TableCell>
                        <Badge variant={SCOPE_VARIANT[apiKey.scope as ApiKeyScope] ?? 'secondary'}>
                          {SCOPE_LABELS[apiKey.scope as ApiKeyScope] ?? apiKey.scope}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted">
                        {OWNER_LABELS[apiKey.owner_type as ApiKeyOwnerType] ?? apiKey.owner_type}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted">
                        {apiKey.label ?? '-'}
                      </TableCell>
                      <TableCell className="text-muted">
                        {formatRelativeLastUsed(apiKey.last_used_at)}
                      </TableCell>
                      <TableCell className="text-muted">{formatDate(apiKey.expires_at)}</TableCell>
                      <TableCell>
                        <Badge variant={apiKey.is_revoked ? 'secondary' : 'success'}>
                          {apiKey.is_revoked ? 'revoked' : 'active'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={apiKey.is_revoked}
                          onClick={() => setRevokeTarget(apiKey)}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted">No API keys issued yet.</p>
            )
          ) : null}
        </CardContent>
      </Card>

      <CreateApiKeyDialog isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} />
      <RevokeApiKeyDialog keyRecord={revokeTarget} onClose={() => setRevokeTarget(null)} />
    </div>
  );
}
