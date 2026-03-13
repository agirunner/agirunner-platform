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
  DialogDescription,
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
import {
  describeProviderTypeSetup,
  summarizeAssignmentSurface,
  validateAssignmentSetup,
  validateAddProviderDraft,
  type AddProviderDraft,
  type ProviderType,
} from './llm-providers-page.support.js';

/* ─── Types ─────────────────────────────────────────────────────────────── */

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

interface RoleDefinitionSummary {
  id: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
}

interface AssignmentRoleRow {
  name: string;
  description: string | null;
  isActive: boolean;
  source: 'catalog' | 'assignment' | 'system';
}

interface ProviderDeleteTarget {
  provider: LlmProvider;
  modelCount: number;
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

const INITIAL_FORM: AddProviderDraft = {
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

export function buildAssignmentRoleRows(
  roleDefinitions: RoleDefinitionSummary[],
  assignments: RoleAssignment[],
): AssignmentRoleRow[] {
  const catalogByName = new Map<string, RoleDefinitionSummary>();
  for (const role of roleDefinitions) {
    const normalizedName = role.name.trim();
    if (normalizedName.length === 0 || catalogByName.has(normalizedName)) {
      continue;
    }
    catalogByName.set(normalizedName, role);
  }

  const activeRoles = [...catalogByName.values()]
    .filter((role) => role.is_active !== false)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map<AssignmentRoleRow>((role) => ({
      name: role.name,
      description: role.description ?? null,
      isActive: true,
      source: 'catalog',
    }));

  const includedNames = new Set(activeRoles.map((role) => role.name));
  includedNames.add('orchestrator');

  const orchestratorRow: AssignmentRoleRow = {
    name: 'orchestrator',
    description:
      'Workflow orchestrator model used for activation planning, delegation, review, and recovery.',
    isActive: true,
    source: 'system',
  };
  const staleRows: AssignmentRoleRow[] = [];
  for (const assignment of assignments) {
    const normalizedName = assignment.role_name.trim();
    if (normalizedName.length === 0 || includedNames.has(normalizedName)) {
      continue;
    }
    includedNames.add(normalizedName);
    const catalogRole = catalogByName.get(normalizedName);
    staleRows.push({
      name: normalizedName,
      description: catalogRole?.description ?? null,
      isActive: catalogRole?.is_active !== false && Boolean(catalogRole),
      source: catalogRole ? 'catalog' : 'assignment',
    });
  }

  staleRows.sort((left, right) => left.name.localeCompare(right.name));
  return [orchestratorRow, ...activeRoles, ...staleRows];
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

async function fetchRoleDefinitions(): Promise<RoleDefinitionSummary[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/roles`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function createProvider(payload: AddProviderDraft): Promise<LlmProvider> {
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
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
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
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
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
            variant="ghost"
            size="sm"
            className="text-red-600 dark:text-red-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
            onClick={() => onDelete(provider.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Provider
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Add Provider Dialog ───────────────────────────────────────────────── */

function AddProviderDialog(props: {
  existingNames: string[];
}): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<AddProviderDraft>(INITIAL_FORM);
  const validation = validateAddProviderDraft(form, {
    existingNames: props.existingNames,
  });
  const providerSetup = describeProviderTypeSetup(form.providerType);
  const providerDefaults = getProviderTypeDefaults(form.providerType);
  const canResetRecommendedEndpoint =
    form.baseUrl.trim() !== providerDefaults.baseUrl.trim();
  const showsRecommendedName =
    providerDefaults.name.trim().length > 0
    && form.name.trim() !== providerDefaults.name.trim();

  function handleProviderTypeChange(providerType: ProviderType) {
    const defaults = PROVIDER_TYPE_DEFAULTS[providerType];
    setForm((prev) => ({
      ...prev,
      providerType,
      name: defaults.name,
      baseUrl: defaults.baseUrl,
    }));
  }

  function handleOpenChange(nextOpen: boolean) {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      setForm(INITIAL_FORM);
      mutation.reset();
    }
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
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <Button onClick={() => setIsOpen(true)}>
        <Plus className="h-4 w-4" />
        Add Provider
      </Button>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add LLM Provider</DialogTitle>
          <DialogDescription>
            Choose the provider type first. The dialog pre-fills the supported endpoint and shows what still needs operator input.
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
                ? 'rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 dark:border-emerald-800 dark:bg-emerald-950/30'
                : 'rounded-xl border border-amber-300 bg-amber-50/80 p-4 dark:border-amber-800 dark:bg-amber-950/30'
            }
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Provider setup</h3>
                <p className="text-sm text-muted">{providerSetup.detail}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{providerSetup.title}</Badge>
                <Badge variant="outline">{providerSetup.authLabel}</Badge>
              </div>
            </div>
            {!validation.isValid ? (
              <ul className="mt-3 space-y-1 text-sm text-amber-950">
                {validation.issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">This provider is ready to save with the current settings.</p>
            )}
          </section>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium">Provider Type</label>
              {canResetRecommendedEndpoint ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      baseUrl: providerDefaults.baseUrl,
                    }))
                  }
                >
                  Restore recommended endpoint
                </Button>
              ) : null}
            </div>
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
            <p className="text-xs text-muted">
              Selecting a provider type auto-fills the recommended name and base URL.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              placeholder="My Provider"
              value={form.name}
              className={validation.fieldErrors.name ? 'border-red-300 focus-visible:ring-red-500' : undefined}
              aria-invalid={validation.fieldErrors.name ? true : undefined}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
            />
            {validation.fieldErrors.name ? (
              <p className="text-xs text-red-600 dark:text-red-400">{validation.fieldErrors.name}</p>
            ) : showsRecommendedName ? (
              <p className="text-xs text-muted">
                Recommended operator label for this provider type: {providerDefaults.name}
              </p>
            ) : (
              <p className="text-xs text-muted">Use a short operator-facing label that will still make sense in assignment and fleet views.</p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Base URL</label>
            <Input
              placeholder={form.providerType === 'openai-compatible' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'}
              value={form.baseUrl}
              className={validation.fieldErrors.baseUrl ? 'border-red-300 focus-visible:ring-red-500' : undefined}
              aria-invalid={validation.fieldErrors.baseUrl ? true : undefined}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, baseUrl: e.target.value }))
              }
            />
            {validation.fieldErrors.baseUrl ? (
              <p className="text-xs text-red-600 dark:text-red-400">{validation.fieldErrors.baseUrl}</p>
            ) : (
              <p className="text-xs text-muted">
                {form.providerType === 'openai-compatible'
                  ? 'Compatible gateways may use either http:// or https:// endpoints.'
                  : `Hosted providers should use a secure https:// endpoint. Recommended: ${providerDefaults.baseUrl}`}
              </p>
            )}
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
              className={validation.fieldErrors.apiKey ? 'border-red-300 focus-visible:ring-red-500' : undefined}
              aria-invalid={validation.fieldErrors.apiKey ? true : undefined}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, apiKey: e.target.value }))
              }
            />
            {validation.fieldErrors.apiKey ? (
              <p className="text-xs text-red-600 dark:text-red-400">{validation.fieldErrors.apiKey}</p>
            ) : (
              <p className="text-xs text-muted">Stored write-only. Existing keys are never shown again.</p>
            )}
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {String(mutation.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || !validation.isValid}>
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
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
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
            variant="ghost"
            size="sm"
            className="text-red-600 dark:text-red-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
            onClick={() => onDelete(provider.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete Provider
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DeleteProviderDialog(props: {
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
        <div className="grid gap-4 rounded-xl border border-border/70 bg-muted/10 p-4">
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
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                Discovered models
              </p>
              <p className="text-base font-semibold text-foreground">{modelCount}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                Removal effect
              </p>
              <p className="text-sm text-foreground">Provider disappears from assignments and discovery.</p>
            </div>
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
            {props.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete Provider
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  modelError,
  layout = 'table',
  onModelChange,
  onReasoningChange,
}: {
  modelId: string;
  reasoningConfig: Record<string, unknown> | null;
  enabledModels: LlmModel[];
  modelError?: string;
  layout?: 'table' | 'stack';
  onModelChange: (modelId: string) => void;
  onReasoningChange: (config: Record<string, unknown> | null) => void;
}): JSX.Element {
  const selectedModel = enabledModels.find((m) => m.id === modelId);
  const modelReasoningSchema = selectedModel?.reasoning_config ?? null;
  const modelTriggerClassName = modelError
    ? layout === 'table'
      ? 'w-[380px] border-red-300 focus-visible:ring-red-500'
      : 'w-full border-red-300 focus-visible:ring-red-500'
    : layout === 'table'
      ? 'w-[380px]'
      : 'w-full';
  const modelField = (
    <div className="space-y-1">
      <Select
        value={modelId}
        onValueChange={(v) => {
          onModelChange(v);
          onReasoningChange(null);
        }}
      >
        <SelectTrigger className={modelTriggerClassName}>
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
      {modelError ? <p className="text-xs text-red-600 dark:text-red-400">{modelError}</p> : null}
    </div>
  );
  const reasoningField = (
    <ReasoningControl
      schema={modelReasoningSchema}
      value={extractReasoningValue(modelReasoningSchema, reasoningConfig)}
      onChange={onReasoningChange}
    />
  );

  if (layout === 'stack') {
    return (
      <div className="grid gap-3">
        <div className="grid gap-1 text-sm">
          <span className="font-medium">Model</span>
          {modelField}
        </div>
        <div className="grid gap-1 text-sm">
          <span className="font-medium">Reasoning</span>
          {reasoningField}
        </div>
      </div>
    );
  }

  return (
    <>
      <TableCell>{modelField}</TableCell>
      <TableCell>{reasoningField}</TableCell>
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
  roleDefinitions,
  systemDefault,
}: {
  enabledModels: LlmModel[];
  assignments: RoleAssignment[];
  roleDefinitions: RoleDefinitionSummary[];
  systemDefault: SystemDefault;
}): JSX.Element {
  const queryClient = useQueryClient();
  const roleRows = buildAssignmentRoleRows(roleDefinitions, assignments);
  const activeRoleCount = roleRows.filter((role) => role.isActive).length;
  const staleRoleCount = roleRows.length - activeRoleCount;

  const [defaultModelId, setDefaultModelId] = useState(systemDefault.modelId ?? '__none__');
  const [defaultReasoning, setDefaultReasoning] = useState<Record<string, unknown> | null>(
    systemDefault.reasoningConfig,
  );

  const [roleStates, setRoleStates] = useState<Record<string, RoleState>>(() => {
    const initial: Record<string, RoleState> = {};
    for (const role of buildAssignmentRoleRows(roleDefinitions, assignments)) {
      const a = assignments.find((x) => x.role_name === role.name);
      initial[role.name] = {
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
    for (const role of roleRows) {
      const a = assignments.find((x) => x.role_name === role.name);
      updated[role.name] = {
        modelId: a?.primary_model_id ?? '__none__',
        reasoningConfig: a?.reasoning_config ?? null,
      };
    }
    setRoleStates(updated);
  }, [assignments, roleDefinitions]);

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

      for (const role of roleRows) {
        const s = roleStates[role.name] ?? { modelId: '__none__', reasoningConfig: null };
        await updateAssignment(role.name, {
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
  const assignmentValidation = validateAssignmentSetup({
    defaultModelId,
    roleAssignments: roleRows.map((role) => ({
      roleName: role.name,
      modelId: roleStates[role.name]?.modelId ?? '__none__',
    })),
  });
  const assignmentSurface = summarizeAssignmentSurface({
    enabledModelCount: enabledModels.length,
    defaultModelConfigured: defaultModelId !== '__none__',
    roleCount: roleRows.length,
    explicitOverrideCount: roleRows.filter(
      (role) => (roleStates[role.name]?.modelId ?? '__none__') !== '__none__',
    ).length,
    staleRoleCount,
    blockingIssues: assignmentValidation.blockingIssues,
  });

  return (
    <div id="llm-model-assignments" className="space-y-6">
      <h2 className="text-lg font-semibold">Model Assignments</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {assignmentSurface.cards.map((card) => (
          <Card key={card.label} className="border-border/70 shadow-sm">
            <CardHeader className="space-y-1 pb-3">
              <p className="text-sm font-medium text-muted">{card.label}</p>
              <CardTitle className="text-xl">{card.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted">{card.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div
        className={
          assignmentSurface.guidance.tone === 'danger'
            ? 'rounded-xl border border-red-300 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
            : assignmentSurface.guidance.tone === 'warning'
              ? 'rounded-xl border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
              : 'rounded-xl border border-emerald-300 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
        }
      >
        <div className="font-medium">{assignmentSurface.guidance.headline}</div>
        <p className="mt-1">{assignmentSurface.guidance.detail}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href="#llm-providers-library">Review providers</a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href="#llm-model-catalog">Review model catalog</a>
          </Button>
        </div>
      </div>

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
            <SelectTrigger
              className={
                assignmentValidation.blockingIssues.length > 0
                  ? 'w-[380px] border-red-300 focus-visible:ring-red-500'
                  : 'w-[380px]'
              }
            >
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
        {assignmentValidation.blockingIssues.length > 0 ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            No system default is configured. Assign explicit models below or restore a default model before saving.
          </p>
        ) : (
          <p className="text-xs text-muted">
            Roles may inherit this model when they do not need an explicit override.
          </p>
        )}
      </div>

      {/* ── Role Overrides ────────────────────────────────────────────── */}
      <div>
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Orchestrator and Role Overrides</h3>
          <p className="text-xs text-muted">
            The orchestrator is always configurable here even though it is not a normal role
            definition. Roles set to &quot;None&quot; inherit the system default, and older
            assignment rows stay visible until they are cleaned up.
          </p>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">1 orchestrator row</Badge>
          <Badge variant="outline">{activeRoleCount} active roles</Badge>
          {staleRoleCount > 0 && (
            <Badge variant="warning">{staleRoleCount} inactive or missing assignments</Badge>
          )}
        </div>
        {assignmentValidation.blockingIssues.length > 0 ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            {assignmentValidation.blockingIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 md:hidden">
          {roleRows.map((role) => {
            const s = roleStates[role.name] ?? { modelId: '__none__', reasoningConfig: null };
            return (
              <Card key={role.name} className="border-border/70 shadow-sm">
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    {role.source === 'system' ? (
                      <Badge variant="secondary">System</Badge>
                    ) : role.isActive ? (
                      <Badge variant="outline">Active</Badge>
                    ) : role.source === 'catalog' ? (
                      <Badge variant="warning">Inactive</Badge>
                    ) : (
                      <Badge variant="warning">Assignment only</Badge>
                    )}
                  </div>
                  <p className="text-sm leading-6 text-muted">
                    {role.description?.trim()
                      ? role.description
                      : role.source === 'assignment'
                        ? 'This assignment references a role that is no longer in the active catalog.'
                        : role.source === 'system'
                          ? 'Configure the dedicated orchestrator model and reasoning policy here.'
                          : 'This configured role is currently inactive.'}
                  </p>
                </CardHeader>
                <CardContent>
                  <ModelReasoningSelect
                    layout="stack"
                    modelId={s.modelId}
                    reasoningConfig={s.reasoningConfig}
                    enabledModels={enabledModels}
                    modelError={
                      assignmentValidation.missingRoleNames.includes(role.name)
                        ? 'Select a model for this role or restore a system default.'
                        : undefined
                    }
                    onModelChange={(id) => updateRole(role.name, { modelId: id, reasoningConfig: null })}
                    onReasoningChange={(cfg) => updateRole(role.name, { reasoningConfig: cfg })}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Role</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Reasoning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roleRows.map((role) => {
                const s = roleStates[role.name] ?? { modelId: '__none__', reasoningConfig: null };
                return (
                  <TableRow key={role.name}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{role.name}</span>
                          {role.source === 'system' ? (
                            <Badge variant="secondary">System</Badge>
                          ) : role.isActive ? (
                            <Badge variant="outline">Active</Badge>
                          ) : role.source === 'catalog' ? (
                            <Badge variant="warning">Inactive</Badge>
                          ) : (
                            <Badge variant="warning">Assignment only</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted">
                          {role.description?.trim()
                            ? role.description
                            : role.source === 'assignment'
                              ? 'This assignment references a role that is no longer in the active catalog.'
                              : role.source === 'system'
                                ? 'Configure the dedicated orchestrator model and reasoning policy here.'
                                : 'This configured role is currently inactive.'}
                        </p>
                      </div>
                    </TableCell>
                    <ModelReasoningSelect
                      modelId={s.modelId}
                      reasoningConfig={s.reasoningConfig}
                      enabledModels={enabledModels}
                      modelError={
                        assignmentValidation.missingRoleNames.includes(role.name)
                          ? 'Select a model for this role or restore a system default.'
                          : undefined
                      }
                      onModelChange={(id) => updateRole(role.name, { modelId: id, reasoningConfig: null })}
                      onReasoningChange={(cfg) => updateRole(role.name, { reasoningConfig: cfg })}
                    />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ── Save ──────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !assignmentValidation.isValid}
        >
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
  const [deleteTarget, setDeleteTarget] = useState<ProviderDeleteTarget | null>(null);

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

  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'llm-assignments'],
    queryFn: fetchRoleDefinitions,
  });

  const systemDefaultQuery = useQuery({
    queryKey: ['llm-system-default'],
    queryFn: fetchSystemDefault,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) {
        throw new Error('Choose a provider to delete.');
      }
      return deleteProvider(deleteTarget.provider.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-providers'] });
      queryClient.invalidateQueries({ queryKey: ['llm-models'] });
      toast.success(`Provider "${deleteTarget?.provider.name ?? 'provider'}" deleted.`);
      setDeleteTarget(null);
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

  const isLoading = providersQuery.isLoading
    || modelsQuery.isLoading
    || assignmentsQuery.isLoading
    || roleDefinitionsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const hasError = providersQuery.error
    || modelsQuery.error
    || assignmentsQuery.error
    || roleDefinitionsQuery.error;
  if (hasError) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load LLM configuration:{' '}
          {String(providersQuery.error ?? modelsQuery.error ?? assignmentsQuery.error ?? roleDefinitionsQuery.error)}
        </div>
      </div>
    );
  }

  const providers = Array.isArray(providersQuery.data) ? providersQuery.data : [];
  const models = Array.isArray(modelsQuery.data) ? modelsQuery.data : [];
  const assignments = Array.isArray(assignmentsQuery.data) ? assignmentsQuery.data : [];
  const roleDefinitions = Array.isArray(roleDefinitionsQuery.data) ? roleDefinitionsQuery.data : [];
  const enabledModels = models.filter((m) => m.is_enabled !== false);

  function requestProviderDelete(providerId: string) {
    const provider = providers.find((entry) => entry.id === providerId);
    if (!provider) {
      toast.error('Provider not found.');
      return;
    }
    setDeleteTarget({
      provider,
      modelCount: models.filter((model) => model.provider_id === providerId).length,
    });
  }

  return (
    <div className="p-6 space-y-8">
      {/* ── Providers Section ──────────────────────────────────────────── */}
      <section id="llm-providers-library" className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">LLM Providers</h1>
            <p className="text-sm text-muted">
              Manage language model providers, the model catalog, and role assignments.
            </p>
          </div>
          <div className="flex gap-2">
            <ConnectOAuthDialog />
            <AddProviderDialog existingNames={providers.map((provider) => provider.name)} />
          </div>
        </div>

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted">
            <BrainCog className="mb-4 h-12 w-12" />
            <p className="font-medium">No providers configured</p>
            <p className="mt-1 text-sm">
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
                  onDelete={requestProviderDelete}
                  onDiscover={handleDiscover}
                  isDiscovering={discoveringId === provider.id}
                />
              ) : (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  modelCount={models.filter((m) => m.provider_id === provider.id).length}
                  onDelete={requestProviderDelete}
                  onDiscover={handleDiscover}
                  isDiscovering={discoveringId === provider.id}
                />
              ),
            )}
          </div>
        )}
      </section>

      {/* ── Model Catalog Section ──────────────────────────────────────── */}
      <section id="llm-model-catalog">
        <ModelCatalog
          models={models}
          providers={providers}
          onToggleEnabled={(modelId, isEnabled) =>
            toggleModelEnabled.mutate({ modelId, isEnabled })
          }
        />
      </section>

      {/* ── Model Assignments Section ──────────────────────────────────── */}
      <RoleAssignmentsSection
        enabledModels={enabledModels}
        assignments={assignments}
        roleDefinitions={roleDefinitions}
        systemDefault={systemDefaultQuery.data ?? { modelId: null, reasoningConfig: null }}
      />

      <DeleteProviderDialog
        target={deleteTarget}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
