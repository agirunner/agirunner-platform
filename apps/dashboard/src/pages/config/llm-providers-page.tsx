import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Plus,
  BrainCog,
  Eye,
  Wrench,
  Globe,
  Trash2,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { Input } from '../../components/ui/input.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/card.js';
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

interface LlmProvider {
  id: string;
  name: string;
  base_url?: string;
  type: string;
  status?: string;
  model_count?: number;
}

interface LlmModel {
  id: string;
  model_id: string;
  provider_id?: string;
  provider_name?: string;
  context_window?: number;
  max_output_tokens?: number;
  supports_tools?: boolean;
  supports_vision?: boolean;
}

interface AddProviderForm {
  name: string;
  base_url: string;
  api_key: string;
  type: string;
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

async function fetchProviders(): Promise<LlmProvider[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/providers`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function fetchModels(): Promise<LlmModel[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/models`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createProvider(
  payload: AddProviderForm,
): Promise<LlmProvider> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/providers`,
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

async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/providers/${providerId}`,
    {
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

function statusVariant(status?: string) {
  if (status === 'active' || status === 'healthy') return 'success' as const;
  if (status === 'degraded') return 'warning' as const;
  if (status === 'error' || status === 'down') return 'destructive' as const;
  return 'secondary' as const;
}

function formatNumber(n?: number): string {
  if (n === undefined || n === null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const INITIAL_FORM: AddProviderForm = {
  name: '',
  base_url: '',
  api_key: '',
  type: 'openai-compatible',
};

function AddProviderDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<AddProviderForm>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () => createProvider(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Provider
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add LLM Provider</DialogTitle>
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
              placeholder="My Provider"
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Base URL</label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={form.base_url}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, base_url: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">API Key</label>
            <Input
              type="password"
              placeholder="sk-..."
              value={form.api_key}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, api_key: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Provider Type</label>
            <Select
              value={form.type}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, type: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-compatible">
                  OpenAI Compatible
                </SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="google">Google</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">
              {String(mutation.error)}
            </p>
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
              Add Provider
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({
  provider,
  onDelete,
}: {
  provider: LlmProvider;
  onDelete: (id: string) => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{provider.name}</CardTitle>
          <Badge variant={statusVariant(provider.status)}>
            {provider.status ?? 'unknown'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {provider.base_url && (
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-muted" />
              <span className="text-muted font-mono text-xs truncate">
                {provider.base_url}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted">Type</span>
            <Badge variant="outline">{provider.type}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Models</span>
            <span className="font-medium">
              {provider.model_count ?? 0}
            </span>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDelete(provider.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function LlmProvidersPage(): JSX.Element {
  const queryClient = useQueryClient();

  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: fetchProviders,
  });

  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: fetchModels,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
    },
  });

  const isLoading = providersQuery.isLoading || modelsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const hasError = providersQuery.error || modelsQuery.error;
  if (hasError) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load LLM configuration:{' '}
          {String(providersQuery.error ?? modelsQuery.error)}
        </div>
      </div>
    );
  }

  const providers = Array.isArray(providersQuery.data)
    ? providersQuery.data
    : [];
  const models = Array.isArray(modelsQuery.data)
    ? modelsQuery.data
    : [];

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">LLM Providers</h1>
          <p className="text-sm text-muted">
            Manage language model providers and the model catalog.
          </p>
        </div>
        <AddProviderDialog />
      </div>

      {deleteMutation.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to delete provider: {String(deleteMutation.error)}
        </div>
      )}

      {providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <BrainCog className="h-12 w-12 mb-4" />
          <p className="font-medium">No providers configured</p>
          <p className="text-sm mt-1">
            Add an LLM provider to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-4">Model Catalog</h2>
        {models.length === 0 ? (
          <p className="text-sm text-muted">
            No models registered. Models appear when providers are
            configured.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model ID</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Context Window</TableHead>
                <TableHead>Max Output</TableHead>
                <TableHead>Tool Use</TableHead>
                <TableHead>Vision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id ?? model.model_id}>
                  <TableCell className="font-mono text-sm">
                    {model.model_id}
                  </TableCell>
                  <TableCell className="text-muted">
                    {model.provider_name ?? model.provider_id ?? '-'}
                  </TableCell>
                  <TableCell>
                    {formatNumber(model.context_window)}
                  </TableCell>
                  <TableCell>
                    {formatNumber(model.max_output_tokens)}
                  </TableCell>
                  <TableCell>
                    {model.supports_tools ? (
                      <Badge variant="success">
                        <Wrench className="h-3 w-3 mr-1" />
                        Yes
                      </Badge>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {model.supports_vision ? (
                      <Badge variant="success">
                        <Eye className="h-3 w-3 mr-1" />
                        Yes
                      </Badge>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
