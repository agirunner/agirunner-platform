import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Loader2,
  Plus,
  BrainCog,
  Globe,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  Link2,
  Unlink,
  ExternalLink,
} from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
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
import { Switch } from '../../components/ui/switch.js';

/* ─── Types ─────────────────────────────────────────────────────────────── */

type ProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'openai-codex';

interface ReasoningConfigSchema {
  type: 'reasoning_effort' | 'effort' | 'thinking_level' | 'thinking_budget';
  options?: string[];
  min?: number;
  max?: number;
  default: string | number;
}

interface OAuthStatus {
  connected: boolean;
  email: string | null;
  authorizedAt: string | null;
  expiresAt: string | null;
  authorizedBy: string | null;
  needsReauth: boolean;
}

interface OAuthProfile {
  profileId: string;
  displayName: string;
  description: string;
  providerType: string;
  costModel: string;
}

interface LlmProvider {
  id: string;
  name: string;
  base_url?: string;
  auth_mode?: string;
  metadata?: { providerType?: ProviderType };
  model_count?: number;
  credentials_configured?: boolean;
}

interface LlmModel {
  id: string;
  model_id: string;
  provider_id?: string;
  provider_name?: string;
  context_window?: number;
  endpoint_type?: string;
  reasoning_config?: ReasoningConfigSchema | null;
  is_enabled?: boolean;
}

interface SystemDefault {
  modelId: string | null;
  reasoningConfig: Record<string, unknown> | null;
}

interface RoleAssignment {
  role_name: string;
  primary_model_id?: string | null;
  reasoning_config?: Record<string, unknown> | null;
}

interface AddProviderForm {
  providerType: ProviderType;
  name: string;
  baseUrl: string;
  apiKey: string;
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

const API_BASE_URL =
  import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

const PROVIDER_TYPE_DEFAULTS: Record<ProviderType, { name: string; baseUrl: string }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  google: { name: 'Google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  'openai-compatible': { name: '', baseUrl: 'http://localhost:11434/v1' },
  'openai-codex': { name: 'OpenAI (Subscription)', baseUrl: 'https://chatgpt.com/backend-api' },
};

const ROLE_NAMES = ['architect', 'developer', 'reviewer', 'qa', 'project-manager'] as const;

const INITIAL_FORM: AddProviderForm = {
  providerType: 'openai',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
};

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function getAuthHeaders(includeContentType = false): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

export function formatContextWindow(n?: number): string {
  if (n === undefined || n === null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

export function reasoningLabel(config?: ReasoningConfigSchema | null): string {
  if (!config) return 'none';
  if (config.options) return `${config.type} (${config.default})`;
  return `${config.type} (${config.default})`;
}

export function reasoningBadgeVariant(config?: ReasoningConfigSchema | null): 'secondary' | 'default' | 'warning' {
  if (!config) return 'secondary';
  return 'default';
}

export function getProviderTypeDefaults(providerType: ProviderType) {
  return PROVIDER_TYPE_DEFAULTS[providerType];
}

/* ─── API Functions ─────────────────────────────────────────────────────── */

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

async function fetchSystemDefault(): Promise<SystemDefault> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/system-default`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? { modelId: null, reasoningConfig: null };
}

async function updateSystemDefault(payload: SystemDefault): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/system-default`,
    {
      method: 'PUT',
      headers: getAuthHeaders(true),
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function fetchAssignments(): Promise<RoleAssignment[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/assignments`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createProvider(payload: AddProviderForm): Promise<LlmProvider> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/providers`,
    {
      method: 'POST',
      headers: getAuthHeaders(true),
      credentials: 'include',
      body: JSON.stringify({
        name: payload.name,
        baseUrl: payload.baseUrl,
        apiKeySecretRef: payload.apiKey,
        metadata: { providerType: payload.providerType },
      }),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function discoverModels(providerId: string): Promise<unknown[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/providers/${providerId}/discover`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
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

async function updateAssignment(
  roleName: string,
  payload: { primaryModelId?: string; reasoningConfig?: Record<string, unknown> | null },
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/assignments/${roleName}`,
    {
      method: 'PUT',
      headers: getAuthHeaders(true),
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function updateModel(
  modelId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/llm/models/${modelId}`,
    {
      method: 'PUT',
      headers: getAuthHeaders(true),
      credentials: 'include',
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/* ─── OAuth API Functions ──────────────────────────────────────────────── */

async function fetchOAuthProfiles(): Promise<OAuthProfile[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/oauth/profiles`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function initiateOAuthFlow(profileId: string): Promise<{ authorizeUrl: string }> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/oauth/authorize`,
    {
      method: 'POST',
      headers: getAuthHeaders(true),
      credentials: 'include',
      body: JSON.stringify({ profileId }),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function fetchOAuthStatus(providerId: string): Promise<OAuthStatus> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/oauth/providers/${providerId}/status`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function disconnectOAuth(providerId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/oauth/providers/${providerId}/disconnect`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/* ─── Connect OAuth Provider Dialog ────────────────────────────────────── */

function ConnectOAuthDialog(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ['oauth-profiles'],
    queryFn: fetchOAuthProfiles,
    enabled: isOpen,
  });

  const connectMutation = useMutation({
    mutationFn: async (profileId: string) => {
      const result = await initiateOAuthFlow(profileId);
      window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => {
      toast.error(`Failed to start OAuth flow: ${String(error)}`);
    },
  });

  const profiles = profilesQuery.data ?? [];

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)}>
        <Link2 className="h-4 w-4" />
        Connect Subscription
      </Button>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Subscription Provider</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted mb-4">
          Use your existing subscription (e.g. ChatGPT Plus/Pro) to access LLM models without separate API billing.
        </p>
        {profilesQuery.isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
          </div>
        )}
        {profilesQuery.error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Failed to load profiles: {String(profilesQuery.error)}
          </div>
        )}
        <div className="space-y-3">
          {profiles.map((profile) => (
            <Card key={profile.profileId} className="cursor-pointer hover:border-primary transition-colors">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-sm text-muted">{profile.description}</p>
                  <Badge variant="outline" className="mt-1">{profile.costModel === 'subscription' ? 'Subscription' : 'Pay-per-token'}</Badge>
                </div>
                <Button
                  size="sm"
                  onClick={() => connectMutation.mutate(profile.profileId)}
                  disabled={connectMutation.isPending}
                >
                  {connectMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5" />
                  )}
                  Connect
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── OAuth Provider Card ──────────────────────────────────────────────── */

function OAuthProviderCard({
  provider,
  modelCount,
  onDelete,
  onDiscover,
  isDiscovering,
}: {
  provider: LlmProvider;
  modelCount: number;
  onDelete: (id: string) => void;
  onDiscover: (id: string) => void;
  isDiscovering: boolean;
}): JSX.Element {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['oauth-status', provider.id],
    queryFn: () => fetchOAuthStatus(provider.id),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectOAuth(provider.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-status', provider.id] });
      toast.success('OAuth disconnected.');
    },
    onError: (error) => {
      toast.error(`Failed to disconnect: ${String(error)}`);
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const profileId = 'openai-codex';
      const result = await initiateOAuthFlow(profileId);
      window.open(result.authorizeUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => {
      toast.error(`Failed to start reconnection: ${String(error)}`);
    },
  });

  const status = statusQuery.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{provider.name}</CardTitle>
          <div className="flex gap-1">
            <Badge variant="outline">oauth</Badge>
            {status?.connected && <Badge variant="default">Connected</Badge>}
            {status?.needsReauth && <Badge variant="destructive">Needs Reconnect</Badge>}
            {status && !status.connected && !status.needsReauth && <Badge variant="secondary">Disconnected</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {status?.email && (
            <div className="flex items-center gap-2">
              <span className="text-muted">Account</span>
              <span className="font-medium">{status.email}</span>
            </div>
          )}
          {status?.authorizedAt && (
            <div className="flex items-center gap-2">
              <span className="text-muted">Connected</span>
              <span className="text-xs">{new Date(status.authorizedAt).toLocaleDateString()}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-muted">Models</span>
            <span className="font-medium">{modelCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">Billing</span>
            <Badge variant="outline">Subscription</Badge>
          </div>
        </dl>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDiscover(provider.id)}
            disabled={isDiscovering}
          >
            {isDiscovering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Refresh Models
          </Button>
          {(status?.needsReauth || (status && !status.connected)) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => reconnectMutation.mutate()}
              disabled={reconnectMutation.isPending}
            >
              {reconnectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Reconnect
            </Button>
          )}
          {status?.connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Unlink className="h-3.5 w-3.5" />
              )}
              Disconnect
            </Button>
          )}
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

/* ─── Add Provider Dialog ───────────────────────────────────────────────── */

function AddProviderDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<AddProviderForm>(INITIAL_FORM);

  function handleProviderTypeChange(providerType: ProviderType) {
    const defaults = PROVIDER_TYPE_DEFAULTS[providerType];
    setForm((prev) => ({
      ...prev,
      providerType,
      name: defaults.name,
      baseUrl: defaults.baseUrl,
    }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const provider = await createProvider(form);
      await discoverModels(provider.id);
      return provider;
    },
    onSuccess: (provider) => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      toast.success(`Provider "${provider.name}" created and models discovered.`);
      setForm(INITIAL_FORM);
      setIsOpen(false);
    },
    onError: (error) => {
      toast.error(`Failed to add provider: ${String(error)}`);
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Provider
      </Button>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
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
            <label className="text-sm font-medium">Provider Type</label>
            <Select
              value={form.providerType}
              onValueChange={(v) => handleProviderTypeChange(v as ProviderType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="openai-compatible">OpenAI-Compatible (Ollama, vLLM, etc.)</SelectItem>
              </SelectContent>
            </Select>
          </div>
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
              placeholder={form.providerType === 'openai-compatible' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'}
              value={form.baseUrl}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              API Key
              {form.providerType === 'openai-compatible' && (
                <span className="ml-1 text-xs font-normal text-muted">(optional)</span>
              )}
            </label>
            <Input
              type="password"
              placeholder={form.providerType === 'openai-compatible' ? 'Set API key (optional)' : 'Paste API key'}
              value={form.apiKey}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, apiKey: e.target.value }))
              }
              required={form.providerType !== 'openai-compatible'}
            />
            <p className="text-xs text-muted">Stored write-only. Existing keys are never shown again.</p>
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

/* ─── Provider Card ─────────────────────────────────────────────────────── */

function ProviderCard({
  provider,
  modelCount,
  onDelete,
  onDiscover,
  isDiscovering,
}: {
  provider: LlmProvider;
  modelCount: number;
  onDelete: (id: string) => void;
  onDiscover: (id: string) => void;
  isDiscovering: boolean;
}): JSX.Element {
  const providerType = provider.metadata?.providerType ?? 'unknown';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{provider.name}</CardTitle>
          <div className="flex gap-1">
            <Badge variant="outline">{providerType}</Badge>
            <Badge variant={provider.credentials_configured ? 'default' : 'secondary'}>
              {provider.credentials_configured ? 'Credentials Set' : 'No Credentials'}
            </Badge>
          </div>
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
            <span className="text-muted">Models</span>
            <span className="font-medium">
              {modelCount}
            </span>
          </div>
        </dl>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDiscover(provider.id)}
            disabled={isDiscovering}
          >
            {isDiscovering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Discover Models
          </Button>
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

/* ─── Role Assignment Row ───────────────────────────────────────────────── */

function buildReasoningValue(
  schema: ReasoningConfigSchema,
  value: string | number,
): Record<string, unknown> {
  return { [schema.type]: value };
}

function extractReasoningValue(
  schema: ReasoningConfigSchema | null | undefined,
  config: Record<string, unknown> | null | undefined,
): string | number | null {
  if (!schema || !config) return null;
  const val = config[schema.type];
  return val !== undefined ? (val as string | number) : null;
}

function ReasoningControl({
  schema,
  value,
  onChange,
}: {
  schema: ReasoningConfigSchema | null | undefined;
  value: string | number | null;
  onChange: (v: Record<string, unknown> | null) => void;
}): JSX.Element | null {
  if (!schema) {
    return <span className="text-sm text-muted">N/A</span>;
  }

  if (schema.options) {
    const current = (value as string) ?? '__default__';
    return (
      <Select
        value={current}
        onValueChange={(v) => {
          if (v === '__default__') {
            onChange(null);
          } else {
            onChange(buildReasoningValue(schema, v));
          }
        }}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">Default ({String(schema.default)})</SelectItem>
          {schema.options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const numValue = (value as number) ?? schema.default;
  const min = schema.min ?? 0;
  const max = schema.max ?? 128000;

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={min}
        max={max}
        value={numValue}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) {
            onChange(buildReasoningValue(schema, Math.max(min, Math.min(max, n))));
          }
        }}
        className="w-[120px]"
      />
      <span className="text-xs text-muted">Thinking budget</span>
    </div>
  );
}

function ModelReasoningSelect({
  modelId,
  reasoningConfig,
  enabledModels,
  onModelChange,
  onReasoningChange,
  label,
}: {
  modelId: string;
  reasoningConfig: Record<string, unknown> | null;
  enabledModels: LlmModel[];
  onModelChange: (modelId: string) => void;
  onReasoningChange: (config: Record<string, unknown> | null) => void;
  label?: string;
}): JSX.Element {
  const selectedModel = enabledModels.find((m) => m.id === modelId);
  const modelReasoningSchema = selectedModel?.reasoning_config ?? null;

  return (
    <>
      {label && <TableCell className="font-medium">{label}</TableCell>}
      <TableCell>
        <Select
          value={modelId}
          onValueChange={(v) => {
            onModelChange(v);
            onReasoningChange(null);
          }}
        >
          <SelectTrigger className="w-[380px]">
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None (use system default)</SelectItem>
            {enabledModels.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.model_id}{m.provider_name ? ` (${m.provider_name})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <ReasoningControl
          schema={modelReasoningSchema}
          value={extractReasoningValue(modelReasoningSchema, reasoningConfig)}
          onChange={onReasoningChange}
        />
      </TableCell>
    </>
  );
}

/* ─── Role Assignments Section ──────────────────────────────────────────── */

interface RoleState {
  modelId: string;
  reasoningConfig: Record<string, unknown> | null;
}

function RoleAssignmentsSection({
  enabledModels,
  assignments,
  systemDefault,
}: {
  enabledModels: LlmModel[];
  assignments: RoleAssignment[];
  systemDefault: SystemDefault;
}): JSX.Element {
  const queryClient = useQueryClient();

  const [defaultModelId, setDefaultModelId] = useState(systemDefault.modelId ?? '__none__');
  const [defaultReasoning, setDefaultReasoning] = useState<Record<string, unknown> | null>(
    systemDefault.reasoningConfig,
  );

  const [roleStates, setRoleStates] = useState<Record<string, RoleState>>(() => {
    const initial: Record<string, RoleState> = {};
    for (const role of ROLE_NAMES) {
      const a = assignments.find((x) => x.role_name === role);
      initial[role] = {
        modelId: a?.primary_model_id ?? '__none__',
        reasoningConfig: a?.reasoning_config ?? null,
      };
    }
    return initial;
  });

  // Sync from server data when it changes
  useEffect(() => {
    setDefaultModelId(systemDefault.modelId ?? '__none__');
    setDefaultReasoning(systemDefault.reasoningConfig);
  }, [systemDefault.modelId, systemDefault.reasoningConfig]);

  useEffect(() => {
    const updated: Record<string, RoleState> = {};
    for (const role of ROLE_NAMES) {
      const a = assignments.find((x) => x.role_name === role);
      updated[role] = {
        modelId: a?.primary_model_id ?? '__none__',
        reasoningConfig: a?.reasoning_config ?? null,
      };
    }
    setRoleStates(updated);
  }, [assignments]);

  const updateRole = (role: string, patch: Partial<RoleState>) => {
    setRoleStates((prev) => ({
      ...prev,
      [role]: { ...prev[role], ...patch },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      await updateSystemDefault({
        modelId: defaultModelId === '__none__' ? null : defaultModelId,
        reasoningConfig: defaultReasoning,
      });

      for (const role of ROLE_NAMES) {
        const s = roleStates[role];
        await updateAssignment(role, {
          primaryModelId: s.modelId === '__none__' ? undefined : s.modelId,
          reasoningConfig: s.reasoningConfig,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-system-default'] });
      queryClient.invalidateQueries({ queryKey: ['llm-assignments'] });
      toast.success('Model assignments saved.');
    },
    onError: (error) => {
      toast.error(`Failed to save assignments: ${String(error)}`);
    },
  });

  const defaultModel = enabledModels.find((m) => m.id === defaultModelId);
  const defaultReasoningSchema = defaultModel?.reasoning_config ?? null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Model Assignments</h2>

      {/* ── System Default ────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">System Default</h3>
          <p className="text-xs text-muted">
            The default model and reasoning level used for all roles unless overridden below.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={defaultModelId} onValueChange={(v) => { setDefaultModelId(v); setDefaultReasoning(null); }}>
            <SelectTrigger className="w-[380px]">
              <SelectValue placeholder="Select default model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {enabledModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.model_id}{m.provider_name ? ` (${m.provider_name})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ReasoningControl
            schema={defaultReasoningSchema}
            value={extractReasoningValue(defaultReasoningSchema, defaultReasoning)}
            onChange={setDefaultReasoning}
          />
        </div>
      </div>

      {/* ── Role Overrides ────────────────────────────────────────────── */}
      <div>
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Role Overrides</h3>
          <p className="text-xs text-muted">
            Optionally override the model and reasoning level for specific roles.
            Roles set to &quot;None&quot; inherit the system default.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Role</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Reasoning</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROLE_NAMES.map((role) => {
              const s = roleStates[role] ?? { modelId: '__none__', reasoningConfig: null };
              return (
                <TableRow key={role}>
                  <ModelReasoningSelect
                    modelId={s.modelId}
                    reasoningConfig={s.reasoningConfig}
                    enabledModels={enabledModels}
                    onModelChange={(id) => updateRole(role, { modelId: id, reasoningConfig: null })}
                    onReasoningChange={(cfg) => updateRole(role, { reasoningConfig: cfg })}
                    label={role}
                  />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Save ──────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          Save All
        </Button>
      </div>
    </div>
  );
}

/* ─── Model Catalog (collapsible by provider) ──────────────────────────── */

function ModelCatalog({
  models,
  providers,
  onToggleEnabled,
}: {
  models: LlmModel[];
  providers: LlmProvider[];
  onToggleEnabled: (modelId: string, isEnabled: boolean) => void;
}): JSX.Element {
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  if (models.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Model Catalog</h2>
        <p className="text-sm text-muted">
          No models registered. Models appear when providers are configured and discovery is run.
        </p>
      </div>
    );
  }

  const grouped = new Map<string, { providerName: string; authMode: string; models: LlmModel[] }>();
  for (const model of models) {
    const pid = model.provider_id ?? 'unknown';
    if (!grouped.has(pid)) {
      const provider = providers.find((p) => p.id === pid);
      const providerName = model.provider_name ?? provider?.name ?? 'Unknown';
      const authMode = provider?.auth_mode ?? 'api_key';
      grouped.set(pid, { providerName, authMode, models: [] });
    }
    grouped.get(pid)!.models.push(model);
  }

  const apiKeyGroups = [...grouped.entries()].filter(([, g]) => g.authMode !== 'oauth');
  const subscriptionGroups = [...grouped.entries()].filter(([, g]) => g.authMode === 'oauth');

  function toggleProvider(providerId: string) {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  }

  function renderProviderGroup(providerId: string, group: { providerName: string; authMode: string; models: LlmModel[] }) {
    const isExpanded = expandedProviders.has(providerId);
    const enabledCount = group.models.filter((m) => m.is_enabled !== false).length;
    return (
      <div key={providerId} className="border rounded-md">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
          onClick={() => toggleProvider(providerId)}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted" />
            )}
            <span className="font-medium">{group.providerName}</span>
            <Badge variant="outline">{enabledCount}/{group.models.length} enabled</Badge>
          </div>
        </button>
        {isExpanded && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model ID</TableHead>
                <TableHead>Context Window</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...group.models].sort((a, b) => {
                const ae = a.is_enabled !== false ? 0 : 1;
                const be = b.is_enabled !== false ? 0 : 1;
                return ae - be;
              }).map((model) => (
                <TableRow key={model.id ?? model.model_id}>
                  <TableCell className="font-mono text-sm">
                    {model.model_id}
                  </TableCell>
                  <TableCell>
                    {formatContextWindow(model.context_window)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {model.endpoint_type ?? '-'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={model.is_enabled !== false}
                      onCheckedChange={(checked) =>
                        onToggleEnabled(model.id, checked)
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Model Catalog
          {apiKeyGroups.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted">
              ({apiKeyGroups.reduce((sum, [, g]) => sum + g.models.length, 0)} models)
            </span>
          )}
        </h2>
        {apiKeyGroups.length === 0 ? (
          <p className="text-sm text-muted">
            No API-key provider models. Add a provider and run discovery.
          </p>
        ) : (
          <div className="space-y-2">
            {apiKeyGroups.map(([pid, group]) => renderProviderGroup(pid, group))}
          </div>
        )}
      </div>

      {subscriptionGroups.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">
            Subscription Models
            <span className="ml-2 text-sm font-normal text-muted">
              ({subscriptionGroups.reduce((sum, [, g]) => sum + g.models.length, 0)} models)
            </span>
          </h2>
          <div className="space-y-2">
            {subscriptionGroups.map(([pid, group]) => renderProviderGroup(pid, group))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */

export function LlmProvidersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);

  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success');
    const oauthError = searchParams.get('oauth_error');
    const oauthEmail = searchParams.get('oauth_email');

    if (oauthSuccess) {
      const msg = oauthEmail
        ? `OAuth connected successfully (${oauthEmail}).`
        : 'OAuth connected successfully.';
      toast.success(msg);
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      setSearchParams({}, { replace: true });
    } else if (oauthError) {
      toast.error(`OAuth failed: ${oauthError}`);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, queryClient]);

  const providersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: fetchProviders,
  });

  const modelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: fetchModels,
  });

  const assignmentsQuery = useQuery({
    queryKey: ['llm-assignments'],
    queryFn: fetchAssignments,
  });

  const systemDefaultQuery = useQuery({
    queryKey: ['llm-system-default'],
    queryFn: fetchSystemDefault,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      toast.success('Provider deleted.');
    },
    onError: (error) => {
      toast.error(`Failed to delete provider: ${String(error)}`);
    },
  });

  const discoverMutation = useMutation({
    mutationFn: discoverModels,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      setDiscoveringId(null);
      toast.success('Model discovery complete.');
    },
    onError: (error) => {
      setDiscoveringId(null);
      toast.error(`Discovery failed: ${String(error)}`);
    },
  });

  const toggleModelEnabled = useMutation({
    mutationFn: ({ modelId, isEnabled }: { modelId: string; isEnabled: boolean }) =>
      updateModel(modelId, { isEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
    },
    onError: (error) => {
      toast.error(`Failed to update model: ${String(error)}`);
    },
  });

  function handleDiscover(providerId: string) {
    setDiscoveringId(providerId);
    discoverMutation.mutate(providerId);
  }

  const isLoading = providersQuery.isLoading || modelsQuery.isLoading || assignmentsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const hasError = providersQuery.error || modelsQuery.error || assignmentsQuery.error;
  if (hasError) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load LLM configuration:{' '}
          {String(providersQuery.error ?? modelsQuery.error ?? assignmentsQuery.error)}
        </div>
      </div>
    );
  }

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const assignments = Array.isArray(assignmentsQuery.data) ? assignmentsQuery.data : [];
  const enabledModels = models.filter((m) => m.is_enabled !== false);

  return (
    <div className="p-6 space-y-8">
      {/* ── Providers Section ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">LLM Providers</h1>
          <p className="text-sm text-muted">
            Manage language model providers, the model catalog, and role assignments.
          </p>
        </div>
        <div className="flex gap-2">
          <ConnectOAuthDialog />
          <AddProviderDialog />
        </div>
      </div>

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
          {providers.map((provider) =>
            provider.auth_mode === 'oauth' ? (
              <OAuthProviderCard
                key={provider.id}
                provider={provider}
                modelCount={models.filter((m) => m.provider_id === provider.id).length}
                onDelete={(id) => deleteMutation.mutate(id)}
                onDiscover={handleDiscover}
                isDiscovering={discoveringId === provider.id}
              />
            ) : (
              <ProviderCard
                key={provider.id}
                provider={provider}
                modelCount={models.filter((m) => m.provider_id === provider.id).length}
                onDelete={(id) => deleteMutation.mutate(id)}
                onDiscover={handleDiscover}
                isDiscovering={discoveringId === provider.id}
              />
            ),
          )}
        </div>
      )}

      {/* ── Model Catalog Section ──────────────────────────────────────── */}
      <ModelCatalog
        models={models}
        providers={providers}
        onToggleEnabled={(modelId, isEnabled) =>
          toggleModelEnabled.mutate({ modelId, isEnabled })
        }
      />

      {/* ── Model Assignments Section ──────────────────────────────────── */}
      <RoleAssignmentsSection
        enabledModels={enabledModels}
        assignments={assignments}
        systemDefault={systemDefaultQuery.data ?? { modelId: null, reasoningConfig: null }}
      />
    </div>
  );
}
