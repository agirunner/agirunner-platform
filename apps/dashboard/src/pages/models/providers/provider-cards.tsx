import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Link2, Loader2, Search, Trash2, Unlink } from 'lucide-react';

import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { dashboardApi } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import {
  DELETE_ACTION_CLASS_NAME,
  ELEVATED_SURFACE_CLASS_NAME,
  SUBDUED_SURFACE_CLASS_NAME,
} from '../models-page.chrome.js';
import type { LlmProvider, ProviderDeleteTarget } from '../models-page.types.js';

export function OAuthProviderCard(props: {
  provider: LlmProvider;
  modelCount: number;
  onDelete(id: string): void;
  onDiscover(id: string): void;
  isDiscovering: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['oauth-status', props.provider.id],
    queryFn: () => dashboardApi.getOAuthProviderStatus(props.provider.id),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => dashboardApi.disconnectOAuthProvider(props.provider.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-status', props.provider.id] });
      toast.success(
        'OAuth disconnected. Models and specialist assignments stay configured, but this provider cannot serve requests until it is reconnected.',
      );
    },
    onError: (error) => {
      toast.error(`Failed to disconnect: ${String(error)}`);
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const result = await dashboardApi.initiateOAuthFlow('openai-codex');
      window.location.assign(result.authorizeUrl);
    },
    onError: (error) => {
      toast.error(`Failed to start reconnection: ${String(error)}`);
    },
  });

  const status = statusQuery.data;

  return (
    <Card className={ELEVATED_SURFACE_CLASS_NAME}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{props.provider.name}</CardTitle>
          <div className="flex gap-1">
            <Badge variant="outline">oauth</Badge>
            {status?.connected ? <Badge variant="default">Connected</Badge> : null}
            {status?.needsReauth ? <Badge variant="destructive">Needs Reconnect</Badge> : null}
            {status && !status.connected && !status.needsReauth ? (
              <Badge variant="secondary">Disconnected</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {status?.email ? (
            <MetadataRow
              label="Account"
              value={<span className="font-medium">{status.email}</span>}
            />
          ) : null}
          {status?.authorizedAt ? (
            <MetadataRow
              label="Connected"
              value={
                <span className="text-xs">
                  {new Date(status.authorizedAt).toLocaleDateString()}
                </span>
              }
            />
          ) : null}
          <MetadataRow
            label="Models"
            value={<span className="font-medium">{props.modelCount}</span>}
          />
          <MetadataRow label="Billing" value={<Badge variant="outline">Subscription</Badge>} />
        </dl>
        {!status?.connected ? (
          <p className="mt-4 text-sm text-muted">
            Models and specialist assignments stay configured, but this provider cannot serve
            requests until OAuth is reconnected.
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <ProviderActionButton
            label="Refresh Models"
            icon={Search}
            isPending={props.isDiscovering}
            onClick={() => props.onDiscover(props.provider.id)}
          />
          {status?.needsReauth || (status && !status.connected) ? (
            <ProviderActionButton
              label="Reconnect"
              icon={Link2}
              isPending={reconnectMutation.isPending}
              onClick={() => reconnectMutation.mutate()}
            />
          ) : null}
          {status?.connected ? (
            <ProviderActionButton
              label="Disconnect"
              icon={Unlink}
              isPending={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className={DELETE_ACTION_CLASS_NAME}
            onClick={() => props.onDelete(props.provider.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Provider
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProviderCard(props: {
  provider: LlmProvider;
  modelCount: number;
  onDelete(id: string): void;
  onDiscover(id: string): void;
  isDiscovering: boolean;
}): JSX.Element {
  const providerType = props.provider.metadata?.providerType ?? 'unknown';

  return (
    <Card className={ELEVATED_SURFACE_CLASS_NAME}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{props.provider.name}</CardTitle>
          <div className="flex gap-1">
            <Badge variant="outline">{providerType}</Badge>
            <Badge variant={props.provider.credentials_configured ? 'default' : 'secondary'}>
              {props.provider.credentials_configured ? 'Credentials Set' : 'No Credentials'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {props.provider.base_url ? (
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted" />
              <span className="truncate font-mono text-xs text-muted">
                {props.provider.base_url}
              </span>
            </div>
          ) : null}
          <MetadataRow
            label="Models"
            value={<span className="font-medium">{props.modelCount}</span>}
          />
        </dl>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <ProviderActionButton
            label="Discover Models"
            icon={Search}
            isPending={props.isDiscovering}
            onClick={() => props.onDiscover(props.provider.id)}
          />
          <Button
            variant="ghost"
            size="sm"
            className={DELETE_ACTION_CLASS_NAME}
            onClick={() => props.onDelete(props.provider.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Provider
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeleteProviderDialog(props: {
  target: ProviderDeleteTarget | null;
  isDeleting: boolean;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
}): JSX.Element | null {
  if (!props.target) {
    return null;
  }

  const { provider, modelCount } = props.target;
  const providerType = provider.metadata?.providerType ?? provider.auth_mode ?? 'provider';
  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete provider?</DialogTitle>
          <DialogDescription>
            Remove this provider and its discovered model catalog from the tenant configuration.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className={SUBDUED_SURFACE_CLASS_NAME}>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{provider.name}</p>
              <Badge variant="outline">{providerType}</Badge>
              <Badge variant={provider.credentials_configured ? 'default' : 'secondary'}>
                {provider.credentials_configured ? 'Credentials set' : 'No credentials'}
              </Badge>
            </div>
            {provider.base_url ? (
              <p className="font-mono text-xs text-muted">{provider.base_url}</p>
            ) : null}
          </div>
          <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-3">
            <p className="text-sm text-foreground">
              Deleting this provider removes its {modelCount} discovered{' '}
              {modelCount === 1 ? 'model' : 'models'} from the catalog and clears any saved model
              assignments that point at them.
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={props.isDeleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={props.onConfirm}
            disabled={props.isDeleting}
          >
            {props.isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Provider
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetadataRow(props: { label: string; value: JSX.Element }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted">{props.label}</span>
      {props.value}
    </div>
  );
}

function ProviderActionButton(props: {
  label: string;
  icon: typeof Search;
  isPending: boolean;
  onClick(): void;
}): JSX.Element {
  const Icon = props.icon;
  return (
    <Button variant="outline" size="sm" onClick={props.onClick} disabled={props.isPending}>
      {props.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5" />
      )}
      {props.label}
    </Button>
  );
}
