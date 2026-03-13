import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ShieldAlert } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
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
import { dashboardApi, type DashboardApiKeyRecord } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { GovernanceReviewField } from './governance-review-field.js';
import {
  formatAbsoluteTimestamp,
  formatExpiryLabel,
  formatRelativeTimestamp,
} from './governance-lifecycle.support.js';
import { describeOwner, scopeDescription, scopeVariant } from './api-key-page.support.js';

export function CreateApiKeyDialog(props: {
  isOpen: boolean;
  onClose(): void;
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
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setCreatedKey(data.api_key);
      toast.success('API key created');
    },
    onError: () => {
      toast.error('Failed to create API key');
    },
  });

  function resetAndClose(): void {
    setScope('agent');
    setLabel('');
    setExpiryDate('');
    setCreatedKey(null);
    setHasCopied(false);
    props.onClose();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (!expiryDate) {
      return;
    }

    mutation.mutate({
      scope,
      label: label.trim(),
      expires_at: new Date(expiryDate).toISOString(),
    });
  }

  async function handleCopy(): Promise<void> {
    if (!createdKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createdKey);
      setHasCopied(true);
      toast.success('API key copied');
      window.setTimeout(() => setHasCopied(false), 2000);
    } catch {
      toast.error('Clipboard access is unavailable in this browser');
    }
  }

  return (
    <Dialog open={props.isOpen} onOpenChange={(open) => !open && resetAndClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{createdKey ? 'Copy the new API key now' : 'Create API key'}</DialogTitle>
          <DialogDescription>
            {createdKey
              ? 'This secret is shown once. Copy it into the destination system before closing the dialog.'
              : 'Choose the narrowest scope, add an audit-friendly label, and set an expiry before issuing the key.'}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Leaving this dialog removes the only visible copy of the secret.</p>
              </div>
            </div>
            <div className="space-y-3 rounded-xl border border-border/70 bg-border/10 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">API key</p>
              <code className="block break-all rounded-lg bg-background px-3 py-3 font-mono text-sm">
                {createdKey}
              </code>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={handleCopy}>
                  {hasCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {hasCopied ? 'Copied' : 'Copy key'}
                </Button>
                <Button type="button" onClick={resetAndClose}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Scope</label>
                <Select value={scope} onValueChange={(value) => setScope(value as 'agent' | 'worker' | 'admin')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">Agent</SelectItem>
                    <SelectItem value="worker">Worker</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted">{scopeDescription(scope)}</p>
              </div>
              <div className="space-y-2">
                <label htmlFor="key-expiry" className="text-sm font-medium">
                  Expiry
                </label>
                <Input
                  id="key-expiry"
                  type="date"
                  value={expiryDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(event) => setExpiryDate(event.target.value)}
                />
                <p className="text-xs leading-5 text-muted">
                  Short-lived keys reduce cleanup and blast radius when credentials leak.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="key-label" className="text-sm font-medium">
                Label
              </label>
              <Input
                id="key-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Deploy automation for Project Atlas"
              />
              <p className="text-xs leading-5 text-muted">
                Use a label that explains who or what owns this key.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-border/10 p-4 text-sm text-muted">
              Keys are shown once after creation. Confirm the receiving system is ready before you issue one.
            </div>
            {mutation.isError ? (
              <p className="text-sm text-red-600">Failed to create API key. Please try again.</p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || !expiryDate}>
                {mutation.isPending ? 'Creating...' : 'Create API key'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RevokeConfirmDialog(props: {
  isOpen: boolean;
  onClose(): void;
  record: DashboardApiKeyRecord;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [confirmationValue, setConfirmationValue] = useState('');

  const mutation = useMutation({
    mutationFn: () => dashboardApi.revokeApiKey(props.record.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast.success('API key revoked');
      setConfirmationValue('');
      props.onClose();
    },
    onError: () => {
      toast.error('Failed to revoke API key');
    },
  });

  const canConfirm = confirmationValue.trim() === props.record.key_prefix;

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmationValue('');
          props.onClose();
        }
      }}
    >
      <DialogContent className="max-h-[calc(100vh-4rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revoke API key</DialogTitle>
          <DialogDescription>
            This stops future use immediately. Type the visible key prefix to confirm the revoke.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-xl border border-border/70 bg-border/10 p-4 sm:grid-cols-2">
          <GovernanceReviewField label="Key prefix" value={`${props.record.key_prefix}...`} mono />
          <GovernanceReviewField label="Scope" value={props.record.scope} badgeVariant={scopeVariant(props.record.scope)} />
          <GovernanceReviewField label="Owner" value={describeOwner(props.record)} />
          <GovernanceReviewField
            label="Expiry"
            value={formatExpiryLabel(props.record.expires_at)}
            title={formatAbsoluteTimestamp(props.record.expires_at)}
          />
          <GovernanceReviewField
            label="Last used"
            value={formatRelativeTimestamp(props.record.last_used_at)}
            title={formatAbsoluteTimestamp(props.record.last_used_at)}
          />
          <GovernanceReviewField
            label="Created"
            value={formatRelativeTimestamp(props.record.created_at)}
            title={formatAbsoluteTimestamp(props.record.created_at)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="confirm-revoke-api-key" className="text-sm font-medium">
            Confirm by typing {props.record.key_prefix}
          </label>
          <Input
            id="confirm-revoke-api-key"
            value={confirmationValue}
            onChange={(event) => setConfirmationValue(event.target.value)}
            placeholder={props.record.key_prefix}
          />
        </div>
        {mutation.isError ? (
          <p className="text-sm text-red-600">Failed to revoke key. Please try again.</p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={props.onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || !canConfirm}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Revoking...' : 'Revoke API key'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
