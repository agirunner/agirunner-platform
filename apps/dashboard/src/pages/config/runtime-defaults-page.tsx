/**
 * Runtime defaults page — structured form for platform-wide container defaults.
 *
 * Replaces the generic key-value CRUD table with labeled fields for each
 * known config key. On save, each field is upserted via POST.
 */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Settings2 } from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

interface RuntimeDefault {
  id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
  created_at: string;
  updated_at: string;
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

async function fetchDefaults(): Promise<RuntimeDefault[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/runtime-defaults`,
    { headers: getAuthHeaders(), credentials: 'include' },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function upsertDefault(payload: {
  configKey: string;
  configValue: string;
  configType: string;
  description: string;
}): Promise<RuntimeDefault> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/config/runtime-defaults`,
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

// ---------------------------------------------------------------------------
// Known config keys
// ---------------------------------------------------------------------------

interface FieldDef {
  key: string;
  label: string;
  description: string;
  configType: string;
  placeholder: string;
  section: 'agent' | 'fleet';
}

const FIELD_DEFS: FieldDef[] = [
  {
    key: 'default_runtime_image',
    label: 'Runtime Image',
    description: 'Docker image used for agent containers.',
    configType: 'string',
    placeholder: 'agirunner-runtime:local',
    section: 'agent',
  },
  {
    key: 'default_cpu',
    label: 'CPU',
    description: 'CPU allocation per container. "0" means unlimited.',
    configType: 'string',
    placeholder: '1',
    section: 'agent',
  },
  {
    key: 'default_memory',
    label: 'Memory',
    description: 'Memory allocation per container (e.g. 256m, 512m, 1g).',
    configType: 'string',
    placeholder: '256m',
    section: 'agent',
  },
  {
    key: 'default_pull_policy',
    label: 'Pull Policy',
    description: 'When to pull the container image from the registry.',
    configType: 'string',
    placeholder: 'if-not-present',
    section: 'agent',
  },
  {
    key: 'default_grace_period',
    label: 'Grace Period (seconds)',
    description: 'Seconds to finish current work before forced shutdown.',
    configType: 'number',
    placeholder: '30',
    section: 'agent',
  },
  {
    key: 'global_max_runtimes',
    label: 'Global Max Runtimes',
    description: 'Maximum total concurrent agent containers across all playbooks.',
    configType: 'number',
    placeholder: '10',
    section: 'fleet',
  },
];

const PULL_POLICY_OPTIONS = ['always', 'if-not-present', 'never'] as const;

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

type FormValues = Record<string, string>;

function buildFormValues(defaults: RuntimeDefault[]): FormValues {
  const values: FormValues = {};
  for (const def of FIELD_DEFS) {
    values[def.key] = '';
  }
  for (const row of defaults) {
    if (row.config_key in values) {
      values[row.config_key] = row.config_value;
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

function FieldGroup({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: string;
  onChange: (value: string) => void;
}) {
  if (def.key === 'default_pull_policy') {
    return (
      <div className="space-y-1.5">
        <label className="text-sm font-medium">{def.label}</label>
        <Select value={value || ''} onValueChange={onChange}>
          <SelectTrigger className="h-9" data-testid={`field-${def.key}`}>
            <SelectValue placeholder={def.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {PULL_POLICY_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted">{def.description}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{def.label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={def.placeholder}
        className="h-9"
        data-testid={`field-${def.key}`}
      />
      <p className="text-xs text-muted">{def.description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function RuntimeDefaultsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['runtime-defaults'],
    queryFn: fetchDefaults,
  });

  const [form, setForm] = useState<FormValues>({});
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(buildFormValues(data));
      setIsDirty(false);
    }
  }, [data]);

  const updateField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const promises = FIELD_DEFS
        .filter((def) => form[def.key] !== undefined && form[def.key] !== '')
        .map((def) =>
          upsertDefault({
            configKey: def.key,
            configValue: form[def.key],
            configType: def.configType,
            description: def.description,
          }),
        );
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      setIsDirty(false);
      toast.success('Runtime defaults saved');
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
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
          Failed to load runtime defaults: {String(error)}
        </div>
      </div>
    );
  }

  const agentFields = FIELD_DEFS.filter((d) => d.section === 'agent');
  const fleetFields = FIELD_DEFS.filter((d) => d.section === 'fleet');

  return (
    <div className="p-6 max-w-2xl space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-muted" />
            <h1 className="text-2xl font-semibold">Runtime Defaults</h1>
          </div>
          <p className="text-sm text-muted mt-1">
            Default container configuration for all playbooks. Playbooks can override individual values.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !isDirty}
          data-testid="save-defaults"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>

      {/* Agent Container Defaults */}
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Agent Container Defaults</h2>
          <p className="text-xs text-muted mt-0.5">
            Resource and image settings applied to every agent container unless overridden by a playbook.
          </p>
        </div>
        <div className="space-y-4 rounded-lg border border-border p-4">
          {agentFields.map((def) => (
            <FieldGroup
              key={def.key}
              def={def}
              value={form[def.key] ?? ''}
              onChange={(v) => updateField(def.key, v)}
            />
          ))}
        </div>
      </section>

      {/* Fleet Limits */}
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Fleet Limits</h2>
          <p className="text-xs text-muted mt-0.5">
            Global constraints on the container fleet.
          </p>
        </div>
        <div className="space-y-4 rounded-lg border border-border p-4">
          {fleetFields.map((def) => (
            <FieldGroup
              key={def.key}
              def={def}
              value={form[def.key] ?? ''}
              onChange={(v) => updateField(def.key, v)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
