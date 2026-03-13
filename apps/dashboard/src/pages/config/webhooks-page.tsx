import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../components/ui/table.js';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import {
  DeleteWebhookDialog,
  WebhookCard,
  WebhookEditorDialog,
  WebhookEmptyState,
  WebhookInspectDialog,
  WebhookOperatorFocusCard,
  WebhookSummaryCards,
  WebhookTableRow,
} from './webhooks-page.sections.js';
import {
  buildWebhookOperatorFocus,
  summarizeWebhookCollection,
  type WebhookRecord,
} from './webhooks-page.support.js';

type EditorTarget = 'create' | WebhookRecord;

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

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

async function fetchWebhooks(): Promise<WebhookRecord[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/webhooks`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

async function createWebhook(payload: {
  url: string;
  event_types: string[];
  secret?: string;
}): Promise<WebhookRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/webhooks`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

async function updateWebhook(
  id: string,
  payload: { url?: string; event_types?: string[]; is_active?: boolean },
): Promise<WebhookRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/webhooks/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

async function deleteWebhook(id: string): Promise<void> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/webhooks/${id}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

export function WebhooksPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [inspectTarget, setInspectTarget] = useState<WebhookRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRecord | null>(null);

  const webhooksQuery = useQuery({
    queryKey: ['webhooks'],
    queryFn: fetchWebhooks,
  });

  const createMutation = useMutation({
    mutationFn: createWebhook,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setEditorTarget(null);
      toast.success('Webhook created');
    },
    onError: () => {
      toast.error('Failed to create webhook');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: { url?: string; event_types?: string[]; is_active?: boolean };
    }) => updateWebhook(id, payload),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      if (variables.payload.is_active === undefined) {
        setEditorTarget(null);
        toast.success('Webhook updated');
        return;
      }
      toast.success(variables.payload.is_active ? 'Webhook enabled' : 'Webhook paused');
    },
    onError: (_error, variables) => {
      toast.error(
        variables.payload.is_active === undefined
          ? 'Failed to update webhook'
          : 'Failed to update webhook delivery',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWebhook,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setDeleteTarget(null);
      setInspectTarget((current) => (current?.id === deleteTarget?.id ? null : current));
      toast.success('Webhook deleted');
    },
    onError: () => {
      toast.error('Failed to delete webhook');
    },
  });

  const webhooks = useMemo(
    () => (Array.isArray(webhooksQuery.data) ? webhooksQuery.data : []),
    [webhooksQuery.data],
  );
  const summaryCards = useMemo(() => summarizeWebhookCollection(webhooks), [webhooks]);
  const operatorFocus = useMemo(() => buildWebhookOperatorFocus(webhooks), [webhooks]);

  const editorMode = editorTarget === 'create' ? 'create' : 'edit';
  const editorWebhook = editorTarget !== 'create' ? editorTarget : null;
  const editorError = editorMode === 'create' ? createMutation.error : updateMutation.error;

  function handleEditorSubmit(payload: {
    url: string;
    event_types: string[];
    secret?: string;
  }): void {
    if (editorMode === 'create') {
      createMutation.mutate(payload);
      return;
    }
    if (!editorWebhook) {
      return;
    }
    updateMutation.mutate({
      id: editorWebhook.id,
      payload: {
        url: payload.url,
        event_types: payload.event_types,
      },
    });
  }

  function openEdit(webhook: WebhookRecord): void {
    setInspectTarget(null);
    setEditorTarget(webhook);
  }

  function isTogglePending(webhookId: string): boolean {
    return updateMutation.isPending && updateMutation.variables?.id === webhookId
      ? updateMutation.variables.payload.is_active !== undefined
      : false;
  }

  if (webhooksQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="h-8 w-40 animate-pulse rounded bg-border/60" />
            <div className="h-4 w-96 max-w-full animate-pulse rounded bg-border/50" />
          </div>
          <div className="h-9 w-36 animate-pulse rounded bg-border/60" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((value) => (
            <div
              key={value}
              className="h-32 animate-pulse rounded-xl border border-border/70 bg-muted/10"
            />
          ))}
        </div>
        <div className="rounded-xl border border-border/70 bg-muted/10 p-8">
          <div className="flex items-center gap-3 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading outbound webhook configuration...
          </div>
        </div>
      </div>
    );
  }

  if (webhooksQuery.error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <span className="font-medium">Could not load outbound webhooks.</span> Refresh the page,
          then verify the dashboard still has admin access to the platform API.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Manage outbound webhook endpoints for workflow, work-item, and task notifications.
            Create the endpoint, inspect the saved delivery posture, then edit or delete it as the
            downstream contract changes.
          </p>
        </div>
        <Button onClick={() => setEditorTarget('create')} data-testid="add-webhook">
          <Plus className="h-4 w-4" />
          Create webhook
        </Button>
      </div>

      <WebhookSummaryCards cards={summaryCards} />
      <WebhookOperatorFocusCard focus={operatorFocus} />

      {webhooks.length === 0 ? (
        <WebhookEmptyState onCreate={() => setEditorTarget('create')} />
      ) : (
        <>
          <div className="space-y-4 lg:hidden">
            {webhooks.map((webhook) => (
              <WebhookCard
                key={webhook.id}
                webhook={webhook}
                isTogglePending={isTogglePending(webhook.id)}
                onToggle={(checked) =>
                  updateMutation.mutate({ id: webhook.id, payload: { is_active: checked } })
                }
                onInspect={() => setInspectTarget(webhook)}
                onEdit={() => openEdit(webhook)}
                onDelete={() => setDeleteTarget(webhook)}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destination</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead className="w-[280px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook) => (
                  <WebhookTableRow
                    key={webhook.id}
                    webhook={webhook}
                    isTogglePending={isTogglePending(webhook.id)}
                    onToggle={(checked) =>
                      updateMutation.mutate({ id: webhook.id, payload: { is_active: checked } })
                    }
                    onInspect={() => setInspectTarget(webhook)}
                    onEdit={() => openEdit(webhook)}
                    onDelete={() => setDeleteTarget(webhook)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <WebhookEditorDialog
        mode={editorMode}
        webhook={editorWebhook}
        open={editorTarget !== null}
        isPending={createMutation.isPending || updateMutation.isPending}
        errorMessage={editorError ? String(editorError) : null}
        onOpenChange={(open) => {
          if (!open) {
            setEditorTarget(null);
          }
        }}
        onSubmit={handleEditorSubmit}
      />

      <WebhookInspectDialog
        webhook={inspectTarget}
        open={inspectTarget !== null}
        onEdit={() => {
          if (inspectTarget) {
            openEdit(inspectTarget);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setInspectTarget(null);
          }
        }}
      />

      <DeleteWebhookDialog
        webhook={deleteTarget}
        isPending={deleteMutation.isPending}
        errorMessage={deleteMutation.error ? String(deleteMutation.error) : null}
        open={deleteTarget !== null}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
