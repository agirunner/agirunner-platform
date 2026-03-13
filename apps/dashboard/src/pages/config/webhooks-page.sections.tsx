import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Eye, Loader2, Pencil, Plus, Trash2, Webhook } from 'lucide-react';

import { RelativeTimestamp } from '../../components/operator-display.js';
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
import { Switch } from '../../components/ui/switch.js';
import { TableCell, TableRow } from '../../components/ui/table.js';
import {
  buildWebhookInspectPackets,
  createWebhookFormState,
  describeWebhookCoverage,
  summarizeWebhookSelection,
  validateWebhookForm,
  WEBHOOK_EVENT_GROUPS,
  type WebhookInspectPacket,
  type WebhookOperatorFocus,
  type WebhookRecord,
} from './webhooks-page.support.js';

export function WebhookSummaryCards(props: {
  cards: Array<{ label: string; value: string; detail: string }>;
}): JSX.Element {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {props.cards.map((summary) => (
        <Card key={summary.label} className="border-border/70 shadow-sm">
          <CardHeader className="space-y-1">
            <p className="text-sm font-medium text-muted">{summary.label}</p>
            <CardTitle className="text-2xl">{summary.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">{summary.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function WebhookOperatorFocusCard(props: { focus: WebhookOperatorFocus }): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>{props.focus.heading}</CardTitle>
        <CardDescription className="max-w-3xl text-sm leading-6">
          {props.focus.summary}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl bg-muted/10 p-4 text-sm leading-6 text-muted">
          <span className="font-medium text-foreground">Best next step:</span>{' '}
          {props.focus.nextAction}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {props.focus.packets.map((packet) => (
            <div key={packet.label} className="rounded-xl border border-border/70 bg-muted/10 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                {packet.label}
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">{packet.value}</p>
              <p className="mt-2 text-sm leading-6 text-muted">{packet.detail}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function WebhookEmptyState(props: { onCreate(): void }): JSX.Element {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-accent/10 p-4">
          <Webhook className="h-8 w-8 text-accent" />
        </div>
        <div className="mt-4 max-w-2xl space-y-2">
          <p className="text-lg font-semibold text-foreground">
            No outbound webhooks are configured
          </p>
          <p className="text-sm leading-6 text-muted">
            Add the first outbound endpoint to route workflow, work-item, and task events into the
            operator systems that need to react in real time.
          </p>
        </div>
        <div className="mt-6 grid w-full max-w-3xl gap-3 md:grid-cols-3">
          <LifecycleNote
            title="Create"
            detail="Add a reachable destination URL and choose whether delivery should stay broad or be scoped to explicit event families."
          />
          <LifecycleNote
            title="Inspect"
            detail="Review the saved endpoint before launch so the URL, coverage, and delivery posture match the downstream system."
          />
          <LifecycleNote
            title="Delete"
            detail="Remove stale destinations instead of leaving dead webhook entries in the catalog."
          />
        </div>
        <Button className="mt-6" onClick={props.onCreate}>
          <Plus className="h-4 w-4" />
          Create first webhook
        </Button>
      </CardContent>
    </Card>
  );
}

export function WebhookEditorDialog(props: {
  mode: 'create' | 'edit';
  webhook: WebhookRecord | null;
  open: boolean;
  isPending: boolean;
  errorMessage: string | null;
  onOpenChange(open: boolean): void;
  onSubmit(payload: { url: string; event_types: string[]; secret?: string }): void;
}): JSX.Element {
  const [form, setForm] = useState(() => createWebhookFormState(props.webhook));

  useEffect(() => {
    if (props.open) {
      setForm(createWebhookFormState(props.webhook));
    }
  }, [props.mode, props.open, props.webhook]);

  const validation = useMemo(() => validateWebhookForm(form), [form]);
  const selectionSummary = useMemo(
    () => summarizeWebhookSelection(form.event_types),
    [form.event_types],
  );

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

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!validation.isValid) {
      return;
    }
    props.onSubmit({
      url: form.url.trim(),
      event_types: form.event_types,
      secret: props.mode === 'create' && form.secret.trim() ? form.secret.trim() : undefined,
    });
  }

  const readinessTone = validation.isValid
    ? 'rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/30'
    : 'rounded-xl border border-amber-300 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/30';

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
        <div className="flex max-h-[85vh] flex-col">
          <DialogHeader className="border-b border-border/70 px-6 py-6">
            <DialogTitle>{props.mode === 'create' ? 'Create webhook' : 'Edit webhook'}</DialogTitle>
            <DialogDescription className="max-w-3xl text-sm leading-6">
              {props.mode === 'create'
                ? 'Configure an outbound endpoint with explicit delivery coverage, then hand it off with enough context for the next operator to validate it.'
                : 'Update the saved destination and delivery scope, then re-inspect the endpoint before considering the handoff complete.'}
            </DialogDescription>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
            <div className="space-y-6 overflow-y-auto px-6 py-6">
              <section className={readinessTone}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold">Save readiness</h3>
                    <p className="text-sm text-muted">
                      {validation.isValid
                        ? props.mode === 'create'
                          ? 'This webhook is ready to create with the current delivery settings.'
                          : 'This webhook is ready to save with the current delivery settings.'
                        : 'Resolve the items below before saving this webhook.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{describeWebhookCoverage(form.event_types)}</Badge>
                    <Badge variant="outline">
                      {props.mode === 'create'
                        ? form.secret.trim()
                          ? 'Known signing secret'
                          : 'Platform-managed secret'
                        : 'Secret rotation not available here'}
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
                <label className="text-sm font-medium">Destination URL</label>
                <Input
                  placeholder="https://example.com/webhook"
                  value={form.url}
                  className={
                    validation.fieldErrors.url
                      ? 'border-red-300 focus-visible:ring-red-500'
                      : undefined
                  }
                  aria-invalid={validation.fieldErrors.url ? true : undefined}
                  onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
                  data-testid="webhook-url-input"
                />
                {validation.fieldErrors.url ? (
                  <p className="text-sm text-red-600 dark:text-red-400">{validation.fieldErrors.url}</p>
                ) : (
                  <p className="text-sm leading-6 text-muted">
                    Use an `http://` or `https://` endpoint reachable by the platform and owned by
                    the team receiving outbound events.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Event coverage</label>
                <p className="text-sm leading-6 text-muted">
                  Choose the events this endpoint should receive. Leave every event clear only when
                  the downstream system truly needs the full outbound stream.
                </p>
                <div className="grid gap-3 sm:grid-cols-3" data-testid="webhook-events-summary">
                  {selectionSummary.map((summary) => (
                    <div
                      key={summary.label}
                      className="rounded-xl border border-border/70 bg-muted/10 p-4"
                    >
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
                            <p className="text-sm leading-6 text-muted">{group.description}</p>
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

              {props.mode === 'create' ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Signing secret (min 8 chars)</label>
                  <Input
                    type="password"
                    placeholder="webhook-secret"
                    value={form.secret}
                    className={
                      validation.fieldErrors.secret
                        ? 'border-red-300 focus-visible:ring-red-500'
                        : undefined
                    }
                    aria-invalid={validation.fieldErrors.secret ? true : undefined}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, secret: event.target.value }))
                    }
                    data-testid="webhook-secret-input"
                  />
                  {validation.fieldErrors.secret ? (
                    <p className="text-sm text-red-600 dark:text-red-400">{validation.fieldErrors.secret}</p>
                  ) : (
                    <p className="text-sm leading-6 text-muted">
                      Optional. Provide a known secret when the receiver validates signatures.
                      Leaving this blank creates a platform-managed secret that is not shown again
                      in this UI.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-border/70 bg-muted/10 p-4 text-sm leading-6 text-muted">
                  <span className="font-medium text-foreground">Signing secret:</span> Secret
                  rotation is not available in this view. Edit the URL and event coverage here, then
                  coordinate any signing-secret changes through the service owner before launch.
                </div>
              )}

              <section className="grid gap-3 md:grid-cols-3">
                <LifecycleNote
                  title="Create"
                  detail="Save the endpoint only after the receiver owner confirms the destination URL and expected event scope."
                />
                <LifecycleNote
                  title="Inspect"
                  detail="Open the saved endpoint next to verify the active state, coverage, and created timestamp before considering it ready."
                />
                <LifecycleNote
                  title="Delete"
                  detail="Remove stale or superseded endpoints instead of leaving them paused indefinitely."
                />
              </section>

              {props.errorMessage ? (
                <p className="text-sm text-red-600 dark:text-red-400">{props.errorMessage}</p>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border/70 px-6 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => props.onOpenChange(false)}
                disabled={props.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={props.isPending || !validation.isValid}
                data-testid="submit-webhook"
              >
                {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {props.mode === 'create' ? 'Create webhook' : 'Save changes'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WebhookInspectDialog(props: {
  webhook: WebhookRecord | null;
  open: boolean;
  onEdit(): void;
  onOpenChange(open: boolean): void;
}): JSX.Element {
  const packets = props.webhook ? buildWebhookInspectPackets(props.webhook) : [];

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspect webhook</DialogTitle>
          <DialogDescription className="max-w-2xl text-sm leading-6">
            Review the saved delivery posture before handing this endpoint off as production-ready.
          </DialogDescription>
        </DialogHeader>
        {props.webhook ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
              <p className="break-all font-mono text-sm text-foreground">{props.webhook.url}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={props.webhook.is_active ? 'success' : 'warning'}>
                  {props.webhook.is_active ? 'Active' : 'Paused'}
                </Badge>
                <Badge variant="outline">
                  {describeWebhookCoverage(props.webhook.event_types)}
                </Badge>
                <RelativeTimestamp value={props.webhook.created_at} prefix="Created" />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {packets.map((packet) => (
                <InspectPacket key={packet.label} packet={packet} />
              ))}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
              <p className="text-sm font-semibold text-foreground">Operator handoff</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                Confirm that the destination owner expects the selected events, the receiver can
                accept signed POST requests, and paused endpoints are either reactivated or deleted
                before launch.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {props.webhook.event_types.length > 0 ? (
                props.webhook.event_types.map((eventType) => (
                  <Badge key={eventType} variant="outline" className="text-xs">
                    {eventType}
                  </Badge>
                ))
              ) : (
                <p className="text-sm leading-6 text-muted">
                  This endpoint currently receives all supported outbound webhook events.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => props.onOpenChange(false)}>
                Close
              </Button>
              <Button onClick={props.onEdit}>
                <Pencil className="h-4 w-4" />
                Edit webhook
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWebhookDialog(props: {
  webhook: WebhookRecord | null;
  isPending: boolean;
  errorMessage: string | null;
  open: boolean;
  onConfirm(): void;
  onOpenChange(open: boolean): void;
}): JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[75vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete webhook</DialogTitle>
          <DialogDescription>
            Remove this outbound endpoint from the delivery catalog. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {props.webhook ? (
          <>
            <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
              <div className="space-y-1">
                <p className="break-all text-sm font-semibold text-foreground">
                  {props.webhook.url}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={props.webhook.is_active ? 'success' : 'warning'}>
                    {props.webhook.is_active ? 'Active' : 'Paused'}
                  </Badge>
                  <Badge variant="outline">
                    {describeWebhookCoverage(props.webhook.event_types)}
                  </Badge>
                </div>
              </div>
              <p className="text-sm leading-6 text-muted">
                Deleting this webhook stops all future outbound deliveries to this endpoint. Use
                delete for stale endpoints instead of leaving dead entries in review queues.
              </p>
            </div>
            {props.errorMessage ? (
              <p className="text-sm text-red-600 dark:text-red-400">{props.errorMessage}</p>
            ) : null}
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => props.onOpenChange(false)}
                disabled={props.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={props.onConfirm}
                disabled={props.isPending}
                data-testid="confirm-delete"
              >
                {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Delete webhook
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function WebhookTableRow(props: {
  webhook: WebhookRecord;
  isTogglePending: boolean;
  onToggle(checked: boolean): void;
  onInspect(): void;
  onEdit(): void;
  onDelete(): void;
}): JSX.Element {
  return (
    <TableRow>
      <TableCell className="max-w-xs">
        <div className="space-y-1">
          <p className="truncate font-mono text-sm text-foreground">{props.webhook.url}</p>
          <RelativeTimestamp value={props.webhook.created_at} prefix="Created" />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {props.webhook.event_types.length > 0 ? (
            props.webhook.event_types.map((eventType) => (
              <Badge key={eventType} variant="outline" className="text-xs">
                {eventType}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted">
              {describeWebhookCoverage(props.webhook.event_types)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <Badge variant={props.webhook.is_active ? 'success' : 'warning'}>
            {props.webhook.is_active ? 'Active' : 'Paused'}
          </Badge>
          <Switch
            checked={props.webhook.is_active}
            onCheckedChange={props.onToggle}
            disabled={props.isTogglePending}
          />
        </div>
      </TableCell>
      <TableCell className="w-[280px]">
        <ActionButtons
          direction="row"
          onInspect={props.onInspect}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
        />
      </TableCell>
    </TableRow>
  );
}

export function WebhookCard(props: {
  webhook: WebhookRecord;
  isTogglePending: boolean;
  onToggle(checked: boolean): void;
  onInspect(): void;
  onEdit(): void;
  onDelete(): void;
}): JSX.Element {
  return (
    <Card className="lg:hidden">
      <CardHeader className="gap-3">
        <div className="space-y-2">
          <CardTitle className="break-all font-mono text-sm">{props.webhook.url}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={props.webhook.is_active ? 'success' : 'warning'}>
              {props.webhook.is_active ? 'Active' : 'Paused'}
            </Badge>
            <Badge variant="outline">{describeWebhookCoverage(props.webhook.event_types)}</Badge>
            <RelativeTimestamp value={props.webhook.created_at} prefix="Created" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {props.webhook.event_types.length > 0 ? (
            props.webhook.event_types.map((eventType) => (
              <Badge key={eventType} variant="outline" className="text-xs">
                {eventType}
              </Badge>
            ))
          ) : (
            <p className="text-sm leading-6 text-muted">
              This endpoint receives all supported events.
            </p>
          )}
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
          <span className="text-sm font-medium">Active delivery</span>
          <Switch
            checked={props.webhook.is_active}
            onCheckedChange={props.onToggle}
            disabled={props.isTogglePending}
          />
        </div>
        <ActionButtons
          direction="column"
          onInspect={props.onInspect}
          onEdit={props.onEdit}
          onDelete={props.onDelete}
        />
      </CardContent>
    </Card>
  );
}

function ActionButtons(props: {
  direction: 'row' | 'column';
  onInspect(): void;
  onEdit(): void;
  onDelete(): void;
}): JSX.Element {
  const isRow = props.direction === 'row';
  return (
    <div className={isRow ? 'flex flex-wrap justify-end gap-2' : 'grid gap-2'}>
      <Button size="sm" variant="outline" onClick={props.onInspect}>
        <Eye className="h-4 w-4" />
        Inspect webhook
      </Button>
      <Button size="sm" variant="outline" onClick={props.onEdit}>
        <Pencil className="h-4 w-4" />
        Edit webhook
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-red-600 dark:text-red-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
        onClick={props.onDelete}
      >
        <Trash2 className="h-4 w-4" />
        Delete webhook
      </Button>
    </div>
  );
}

function InspectPacket(props: { packet: WebhookInspectPacket }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.packet.label}
      </p>
      <p className="mt-2 text-sm font-semibold text-foreground">{props.packet.value}</p>
      <p className="mt-2 text-sm leading-6 text-muted">{props.packet.detail}</p>
    </div>
  );
}

function LifecycleNote(props: { title: string; detail: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
        {props.title}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted">{props.detail}</p>
    </div>
  );
}
