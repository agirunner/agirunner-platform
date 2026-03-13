import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Trash2,
  Webhook,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import { Switch } from '../../components/ui/switch.js';
import {
  Card,
  CardContent,
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import {
  describeWebhookCoverage,
  summarizeWebhookSelection,
  summarizeWebhookCollection,
  validateWebhookForm,
  WEBHOOK_EVENT_GROUPS,
  type CreateWebhookFormState,
} from './webhooks-page.support.js';

interface WebhookRecord {
  id: string;
  url: string;
  event_types: string[];
  is_active: boolean;
  created_at?: string;
}

interface WebhookDeleteTarget {
  id: string;
  url: string;
  event_types: string[];
  is_active: boolean;
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

async function fetchWebhooks(): Promise<WebhookRecord[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/webhooks`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function updateWebhook(
  id: string,
  payload: { is_active?: boolean },
): Promise<WebhookRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/webhooks/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

const INITIAL_FORM: CreateWebhookFormState = {
  url: '',
  event_types: [],
  secret: '',
};

function CreateWebhookDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<CreateWebhookFormState>(INITIAL_FORM);
  const validation = validateWebhookForm(form);
  const selectionSummary = summarizeWebhookSelection(form.event_types);

  const mutation = useMutation({
    mutationFn: () =>
      createWebhook({
        url: form.url,
        event_types: form.event_types,
        secret: form.secret || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
      toast.success('Webhook created');
    },
    onError: () => {
      toast.error('Failed to create webhook');
    },
  });

  function toggleEventType(eventType: string): void {
    setForm((prev) => ({
      ...prev,
      event_types: prev.event_types.includes(eventType)
        ? prev.event_types.filter((value) => value !== eventType)
        : [...prev.event_types, eventType],
    }));
  }

  function setEventGroupSelection(groupEvents: string[], shouldSelect: boolean): void {
    setForm((prev) => ({
      ...prev,
      event_types: shouldSelect
        ? Array.from(new Set([...prev.event_types, ...groupEvents]))
        : prev.event_types.filter((value) => !groupEvents.includes(value)),
    }));
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)} data-testid="add-webhook">
        <Plus className="h-4 w-4" />
        Add Webhook
      </Button>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Webhook</DialogTitle>
          <DialogDescription>
            Configure a structured outbound endpoint with explicit event coverage and delivery safeguards.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!validation.isValid) {
              return;
            }
            mutation.mutate();
          }}
        >
          <section
            className={
              validation.isValid
                ? 'rounded-xl border border-emerald-300 bg-emerald-50/70 p-4'
                : 'rounded-xl border border-amber-300 bg-amber-50/80 p-4'
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Save readiness</h3>
                <p className="text-sm text-muted">
                  {validation.isValid
                    ? 'This webhook is ready to create with the current delivery settings.'
                    : 'Resolve the items below before creating this webhook.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{describeWebhookCoverage(form.event_types)}</Badge>
                <Badge variant="outline">
                  {form.secret.trim() ? 'Secret will be stored' : 'No secret configured'}
                </Badge>
              </div>
            </div>
            {!validation.isValid ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-950">
                {validation.issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <div className="space-y-2">
            <label className="text-sm font-medium">URL</label>
            <Input
              placeholder="https://example.com/webhook"
              value={form.url}
              className={validation.fieldErrors.url ? 'border-red-300 focus-visible:ring-red-500' : undefined}
              aria-invalid={validation.fieldErrors.url ? true : undefined}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, url: e.target.value }))
              }
              data-testid="webhook-url-input"
            />
            {validation.fieldErrors.url ? (
              <p className="text-sm text-red-600">{validation.fieldErrors.url}</p>
            ) : (
              <p className="text-sm text-muted">Use an http:// or https:// endpoint reachable by the platform.</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Event Types</label>
            <p className="text-sm text-muted">
              Choose the events this endpoint should receive. Leave everything unchecked to receive all supported events.
            </p>
            <div className="grid gap-3 sm:grid-cols-3" data-testid="webhook-events-summary">
              {selectionSummary.map((summary) => (
                <div key={summary.label} className="rounded-xl border border-border/70 bg-muted/10 p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                    {summary.label}
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">{summary.value}</p>
                  <p className="mt-2 text-xs leading-5 text-muted">{summary.detail}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3" data-testid="webhook-events-input">
              {WEBHOOK_EVENT_GROUPS.map((group) => {
                const selectedCount = group.eventTypes.filter((eventType) =>
                  form.event_types.includes(eventType),
                ).length;
                const allSelected = selectedCount === group.eventTypes.length;
                return (
                  <div
                    key={group.key}
                    className="rounded-xl border border-border/70 bg-muted/10 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{group.label}</p>
                          <Badge variant="outline">
                            {selectedCount === 0
                              ? 'All included by default'
                              : `${selectedCount}/${group.eventTypes.length} selected`}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted">{group.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant={allSelected ? 'secondary' : 'outline'}
                          size="sm"
                          onClick={() => setEventGroupSelection(group.eventTypes, true)}
                        >
                          Select group
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setEventGroupSelection(group.eventTypes, false)}
                        >
                          Clear group
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {group.eventTypes.map((eventType) => {
                        const selected = form.event_types.includes(eventType);
                        return (
                          <Button
                            key={eventType}
                            type="button"
                            variant={selected ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => toggleEventType(eventType)}
                          >
                            {eventType}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Secret (min 8 chars)</label>
            <Input
              type="password"
              placeholder="webhook-secret"
              value={form.secret}
              className={validation.fieldErrors.secret ? 'border-red-300 focus-visible:ring-red-500' : undefined}
              aria-invalid={validation.fieldErrors.secret ? true : undefined}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, secret: e.target.value }))
              }
              data-testid="webhook-secret-input"
            />
            {validation.fieldErrors.secret ? (
              <p className="text-sm text-red-600">{validation.fieldErrors.secret}</p>
            ) : (
              <p className="text-sm text-muted">Optional. Add a signing secret when the receiving endpoint verifies authenticity.</p>
            )}
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
            <Button type="submit" disabled={mutation.isPending || !validation.isValid} data-testid="submit-webhook">
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

function DeleteWebhookDialog({
  webhook,
  onClose,
}: {
  webhook: WebhookDeleteTarget;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteWebhook(webhook.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      onClose();
      toast.success('Webhook deleted');
    },
    onError: () => {
      toast.error('Failed to delete webhook');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete Webhook</DialogTitle>
          <DialogDescription>
            Remove this outbound endpoint from the notification catalog. This action cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground break-all">{webhook.url}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant={webhook.is_active ? 'default' : 'secondary'}>
                {webhook.is_active ? 'Active' : 'Inactive'}
              </Badge>
              <Badge variant="outline">{describeWebhookCoverage(webhook.event_types)}</Badge>
            </div>
          </div>
          <p className="text-sm text-muted">
            Deleting this webhook stops all future outbound deliveries to this endpoint.
          </p>
        </div>
        {mutation.error && (
          <p className="text-sm text-red-600">{String(mutation.error)}</p>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
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
            Delete Webhook
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useWebhookEntryState(webhook: WebhookRecord) {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<WebhookDeleteTarget | null>(null);

  const toggleMutation = useMutation({
    mutationFn: (checked: boolean) =>
      updateWebhook(webhook.id, { is_active: checked }),
    onSuccess: (_data, checked) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success(checked ? 'Webhook enabled' : 'Webhook disabled');
    },
    onError: () => {
      toast.error('Failed to update webhook');
    },
  });

  return {
    deleteTarget,
    toggleMutation,
    dismissDelete: () => setDeleteTarget(null),
    openDelete: () =>
      setDeleteTarget({
        id: webhook.id,
        url: webhook.url,
        event_types: webhook.event_types,
        is_active: webhook.is_active,
      }),
  };
}

function WebhookTableRow({
  webhook,
}: {
  webhook: WebhookRecord;
}): JSX.Element {
  const controls = useWebhookEntryState(webhook);

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-sm truncate max-w-xs">
          {webhook.url}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {webhook.event_types.length > 0 ? (
              webhook.event_types.map((evt) => (
                <Badge key={evt} variant="outline" className="text-xs">
                  {evt}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted">{describeWebhookCoverage(webhook.event_types)}</span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Switch
            checked={webhook.is_active}
            onCheckedChange={(checked) => controls.toggleMutation.mutate(checked)}
            disabled={controls.toggleMutation.isPending}
          />
        </TableCell>
        <TableCell>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
            onClick={controls.openDelete}
          >
            <Trash2 className="h-4 w-4" />
            Delete Webhook
          </Button>
        </TableCell>
      </TableRow>
      {controls.deleteTarget && (
        <DeleteWebhookDialog
          webhook={controls.deleteTarget}
          onClose={controls.dismissDelete}
        />
      )}
    </>
  );
}

function WebhookCard({
  webhook,
}: {
  webhook: WebhookRecord;
}): JSX.Element {
  const controls = useWebhookEntryState(webhook);

  return (
    <>
      <Card className="lg:hidden">
        <CardHeader className="gap-3">
          <div className="space-y-2">
            <CardTitle className="break-all font-mono text-sm">{webhook.url}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant={webhook.is_active ? 'default' : 'secondary'}>
                {webhook.is_active ? 'Active' : 'Paused'}
              </Badge>
              <Badge variant="outline">{describeWebhookCoverage(webhook.event_types)}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {webhook.event_types.length > 0 ? (
              webhook.event_types.map((eventType) => (
                <Badge key={eventType} variant="outline" className="text-xs">
                  {eventType}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted">This endpoint receives all supported events.</p>
            )}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 rounded-md border border-border/70 px-3 py-2">
              <span className="text-sm font-medium">Active delivery</span>
              <Switch
                checked={webhook.is_active}
                onCheckedChange={(checked) => controls.toggleMutation.mutate(checked)}
                disabled={controls.toggleMutation.isPending}
              />
            </div>
            <Button
              variant="outline"
              className="justify-start text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 sm:justify-center"
              onClick={controls.openDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete Webhook
            </Button>
          </div>
        </CardContent>
      </Card>
      {controls.deleteTarget ? (
        <DeleteWebhookDialog webhook={controls.deleteTarget} onClose={controls.dismissDelete} />
      ) : null}
    </>
  );
}

export function WebhooksPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['webhooks'],
    queryFn: fetchWebhooks,
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
          Failed to load webhooks: {String(error)}
        </div>
      </div>
    );
  }

  const webhooks = Array.isArray(data) ? data : [];
  const summaryCards = summarizeWebhookCollection(webhooks);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="text-sm text-muted">
            Manage outbound webhook endpoints for event notifications.
          </p>
        </div>
        <CreateWebhookDialog />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((summary) => (
          <Card key={summary.label}>
            <CardHeader className="space-y-1">
              <p className="text-sm font-medium text-muted">{summary.label}</p>
              <CardTitle className="text-2xl">{summary.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">{summary.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {webhooks.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center text-muted">
            <Webhook className="mb-4 h-12 w-12" />
            <p className="font-medium">No webhooks configured</p>
            <p className="mt-1 text-sm">
              Add a webhook endpoint to receive event notifications.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-4 lg:hidden">
            {webhooks.map((webhook) => (
              <WebhookCard key={webhook.id} webhook={webhook} />
            ))}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Event Types</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-[180px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((webhook) => (
                  <WebhookTableRow key={webhook.id} webhook={webhook} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
