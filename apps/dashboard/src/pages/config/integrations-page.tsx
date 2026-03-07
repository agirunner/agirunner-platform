import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  Trash2,
  Plug,
} from 'lucide-react';
import {
  dashboardApi,
  type DashboardIntegrationRecord,
} from '../../lib/api.js';
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

type IntegrationKind = DashboardIntegrationRecord['kind'];

const KIND_LABELS: Record<IntegrationKind, string> = {
  webhook: 'Webhook',
  slack: 'Slack',
  otlp_http: 'OTLP HTTP',
  github_issues: 'GitHub Issues',
};

const KIND_FIELDS: Record<IntegrationKind, string[]> = {
  webhook: ['url', 'secret'],
  slack: ['webhook_url', 'channel'],
  otlp_http: ['endpoint', 'headers'],
  github_issues: ['owner', 'repo', 'token'],
};

function kindVariant(kind: IntegrationKind) {
  const map: Record<IntegrationKind, 'default' | 'secondary' | 'outline' | 'warning'> = {
    webhook: 'default',
    slack: 'secondary',
    otlp_http: 'outline',
    github_issues: 'warning',
  };
  return map[kind] ?? ('outline' as const);
}

function normalizeIntegrations(
  data: DashboardIntegrationRecord[] | { data: DashboardIntegrationRecord[] } | undefined,
): DashboardIntegrationRecord[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.data ?? [];
}

interface AddIntegrationForm {
  kind: IntegrationKind;
  workflow_id: string;
  subscriptions: string;
  config: Record<string, string>;
}

const INITIAL_FORM: AddIntegrationForm = {
  kind: 'webhook',
  workflow_id: '',
  subscriptions: '',
  config: {},
};

function AddIntegrationDialog() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<AddIntegrationForm>(INITIAL_FORM);

  const configFields = KIND_FIELDS[form.kind] ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      dashboardApi.createIntegration({
        kind: form.kind,
        workflow_id: form.workflow_id || undefined,
        subscriptions: form.subscriptions
          ? form.subscriptions.split(',').map((s) => s.trim())
          : undefined,
        config: form.config,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
    },
  });

  function updateConfigField(field: string, value: string) {
    setForm((prev) => ({
      ...prev,
      config: { ...prev.config, [field]: value },
    }));
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Integration
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Integration</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Kind</label>
            <Select
              value={form.kind}
              onValueChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  kind: v as IntegrationKind,
                  config: {},
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Workflow ID (optional, leave blank for global)
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
            <label className="text-sm font-medium">
              Subscriptions (comma-separated)
            </label>
            <Input
              placeholder="workflow.completed, task.failed"
              value={form.subscriptions}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, subscriptions: e.target.value }))
              }
            />
          </div>

          {configFields.map((field) => (
            <div key={field} className="space-y-2">
              <label className="text-sm font-medium capitalize">
                {field.replace(/_/g, ' ')}
              </label>
              <Input
                placeholder={field}
                value={form.config[field] ?? ''}
                onChange={(e) => updateConfigField(field, e.target.value)}
                type={
                  field.includes('secret') || field.includes('token')
                    ? 'password'
                    : 'text'
                }
              />
            </div>
          ))}

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
            <Button type="submit" disabled={mutation.isPending}>
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

function DeleteConfirmDialog({
  integrationId,
  onClose,
}: {
  integrationId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => dashboardApi.deleteIntegration(integrationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Integration</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          Are you sure you want to delete this integration? This action cannot
          be undone.
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

function IntegrationRow({
  integration,
}: {
  integration: DashboardIntegrationRecord;
}) {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: (checked: boolean) =>
      dashboardApi.updateIntegration(integration.id, {
        is_active: checked,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  return (
    <>
      <TableRow>
        <TableCell>
          <Badge variant={kindVariant(integration.kind)}>
            {KIND_LABELS[integration.kind] ?? integration.kind}
          </Badge>
        </TableCell>
        <TableCell className="text-sm text-muted font-mono">
          {integration.workflow_id ?? 'Global'}
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {integration.subscriptions.length > 0 ? (
              integration.subscriptions.map((sub) => (
                <Badge key={sub} variant="outline" className="text-xs">
                  {sub}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted">All events</span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <Switch
            checked={integration.is_active}
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
        <DeleteConfirmDialog
          integrationId={integration.id}
          onClose={() => setDeleteTarget(false)}
        />
      )}
    </>
  );
}

export function IntegrationsPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => dashboardApi.listIntegrations(),
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
          Failed to load integrations: {String(error)}
        </div>
      </div>
    );
  }

  const integrations = normalizeIntegrations(data);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted">
            Manage webhooks, notifications, and external service connections.
          </p>
        </div>
        <AddIntegrationDialog />
      </div>

      {integrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <Plug className="h-12 w-12 mb-4" />
          <p className="font-medium">No integrations configured</p>
          <p className="text-sm mt-1">
            Add an integration to connect with external services.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Subscriptions</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="w-[60px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrations.map((integration) => (
              <IntegrationRow
                key={integration.id}
                integration={integration}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
