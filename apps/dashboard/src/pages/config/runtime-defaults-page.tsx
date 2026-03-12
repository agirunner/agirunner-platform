import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, Server } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { ActiveRuntimeImageCard, BuildHistoryCard } from './runtimes-build-history.js';

interface RuntimeDefault {
  id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
}

interface FieldDefinition {
  key: string;
  label: string;
  description: string;
  configType: 'string' | 'number';
  placeholder: string;
  section: 'containers' | 'fleet' | 'search';
}

type FormValues = Record<string, string>;

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';
const PULL_POLICY_OPTIONS = ['always', 'if-not-present', 'never'] as const;
const WEB_SEARCH_PROVIDER_OPTIONS = ['duckduckgo', 'serper', 'tavily'] as const;
const PLATFORM_DEFAULT_SELECT_VALUE = '__default__';
const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: 'default_runtime_image',
    label: 'Runtime image',
    description: 'Docker image used for agent containers unless a playbook overrides it.',
    configType: 'string',
    placeholder: 'agirunner-runtime:local',
    section: 'containers',
  },
  {
    key: 'default_cpu',
    label: 'Default CPU allocation',
    description: 'CPU allocation per container. Use 0 only when you intentionally want no limit.',
    configType: 'string',
    placeholder: '1',
    section: 'containers',
  },
  {
    key: 'default_memory',
    label: 'Default memory allocation',
    description: 'Memory allocation per container, for example 512m or 1g.',
    configType: 'string',
    placeholder: '512m',
    section: 'containers',
  },
  {
    key: 'default_pull_policy',
    label: 'Image pull policy',
    description: 'When the runtime should pull container images from the registry.',
    configType: 'string',
    placeholder: 'if-not-present',
    section: 'containers',
  },
  {
    key: 'default_grace_period',
    label: 'Grace period (seconds)',
    description: 'How long a runtime gets to finish work before forced shutdown.',
    configType: 'number',
    placeholder: '30',
    section: 'containers',
  },
  {
    key: 'global_max_runtimes',
    label: 'Global runtime cap',
    description: 'Maximum concurrent agent containers across all playbooks.',
    configType: 'number',
    placeholder: '10',
    section: 'fleet',
  },
  {
    key: 'tools.web_search_provider',
    label: 'Web search provider',
    description: 'Primary provider used by the runtime for web_search. DuckDuckGo remains the built-in fallback when the configured provider is unavailable.',
    configType: 'string',
    placeholder: 'duckduckgo',
    section: 'search',
  },
  {
    key: 'tools.web_search_base_url',
    label: 'Provider base URL',
    description: 'Optional override for the selected provider endpoint. Leave blank to use the provider default URL.',
    configType: 'string',
    placeholder: 'https://google.serper.dev/search',
    section: 'search',
  },
  {
    key: 'tools.web_search_api_key_secret_ref',
    label: 'Provider API key secret ref',
    description: 'Secret reference used when the provider requires an API key, for example secret:SERPER_API_KEY.',
    configType: 'string',
    placeholder: 'secret:SERPER_API_KEY',
    section: 'search',
  },
];

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

async function fetchRuntimeDefaults(): Promise<RuntimeDefault[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  return body.data ?? body;
}

async function upsertRuntimeDefault(input: {
  configKey: string;
  configValue: string;
  configType: 'string' | 'number';
  description: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

async function deleteRuntimeDefault(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
}

function buildEmptyForm(): FormValues {
  return Object.fromEntries(FIELD_DEFINITIONS.map((field) => [field.key, '']));
}

function buildFormValues(defaults: RuntimeDefault[]): FormValues {
  const values = buildEmptyForm();
  for (const row of defaults) {
    if (row.config_key in values) {
      values[row.config_key] = row.config_value;
    }
  }
  return values;
}

function buildDefaultsByKey(defaults: RuntimeDefault[]): Map<string, RuntimeDefault> {
  return new Map(defaults.map((row) => [row.config_key, row]));
}

function RuntimeField({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor={field.key}>
          {field.label}
        </label>
        <p className="text-xs leading-5 text-muted">{field.description}</p>
      </div>
      {field.key === 'default_pull_policy' ? (
        <Select
          value={value || PLATFORM_DEFAULT_SELECT_VALUE}
          onValueChange={(nextValue) =>
            onChange(nextValue === PLATFORM_DEFAULT_SELECT_VALUE ? '' : nextValue)
          }
        >
          <SelectTrigger id={field.key} className="h-10" data-testid={`field-${field.key}`}>
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PLATFORM_DEFAULT_SELECT_VALUE}>Use platform default</SelectItem>
            {PULL_POLICY_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.key === 'tools.web_search_provider' ? (
        <Select
          value={value || PLATFORM_DEFAULT_SELECT_VALUE}
          onValueChange={(nextValue) =>
            onChange(nextValue === PLATFORM_DEFAULT_SELECT_VALUE ? '' : nextValue)
          }
        >
          <SelectTrigger id={field.key} className="h-10" data-testid={`field-${field.key}`}>
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PLATFORM_DEFAULT_SELECT_VALUE}>Use platform default</SelectItem>
            {WEB_SEARCH_PROVIDER_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={field.key}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          className="h-10"
          data-testid={`field-${field.key}`}
        />
      )}
    </div>
  );
}

function RuntimeDefaultsSection({
  title,
  description,
  fields,
  values,
  onChange,
}: {
  title: string;
  description: string;
  fields: FieldDefinition[];
  values: FormValues;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        {fields.map((field) => (
          <RuntimeField
            key={field.key}
            field={field}
            value={values[field.key] ?? ''}
            onChange={(value) => onChange(field.key, value)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function RuntimeDefaultsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['runtime-defaults'],
    queryFn: fetchRuntimeDefaults,
  });
  const [formValues, setFormValues] = useState<FormValues>(buildEmptyForm());
  const [isDirty, setIsDirty] = useState(false);
  const defaultsByKey = useMemo(() => buildDefaultsByKey(data), [data]);

  useEffect(() => {
    setFormValues(buildFormValues(data));
    setIsDirty(false);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const operations = FIELD_DEFINITIONS.flatMap((field) => {
        const value = (formValues[field.key] ?? '').trim();
        const existing = defaultsByKey.get(field.key);
        if (!value) {
          return existing ? [deleteRuntimeDefault(existing.id)] : [];
        }
        return [
          upsertRuntimeDefault({
            configKey: field.key,
            configValue: value,
            configType: field.configType,
            description: field.description,
          }),
        ];
      });
      await Promise.all(operations);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      setIsDirty(false);
      toast.success('Runtime configuration saved');
    },
    onError: (errorValue) => {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      toast.error(`Failed to save runtime configuration: ${message}`);
    },
  });

  function updateField(key: string, value: string): void {
    setFormValues((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
  }

  function resetForm(): void {
    setFormValues(buildFormValues(data));
    setIsDirty(false);
  }

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
          Failed to load runtime configuration: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mx-auto grid max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-muted" />
                  <CardTitle className="text-2xl">Runtimes</CardTitle>
                </div>
                <CardDescription className="max-w-2xl text-sm leading-6">
                  Configure platform-wide runtime defaults for agent containers and fleet limits.
                  Playbooks can override these values when they need a different execution posture.
                  Clear a value and save to fall back to the platform default.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={resetForm} disabled={!isDirty || saveMutation.isPending}>
                  <RotateCcw className="h-4 w-4" />
                  Reset changes
                </Button>
                <Button onClick={() => saveMutation.mutate()} disabled={!isDirty || saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </Button>
              </div>
            </CardHeader>
          </Card>

          <RuntimeDefaultsSection
            title="Agent container defaults"
            description="Default image and resource limits applied to agent containers."
            fields={FIELD_DEFINITIONS.filter((field) => field.section === 'containers')}
            values={formValues}
            onChange={updateField}
          />
          <RuntimeDefaultsSection
            title="Fleet limits"
            description="Global concurrency and capacity settings that affect all playbooks."
            fields={FIELD_DEFINITIONS.filter((field) => field.section === 'fleet')}
            values={formValues}
            onChange={updateField}
          />
          <RuntimeDefaultsSection
            title="Web research"
            description="Select the runtime web_search provider and any provider-specific endpoint or secret-ref settings."
            fields={FIELD_DEFINITIONS.filter((field) => field.section === 'search')}
            values={formValues}
            onChange={updateField}
          />
        </div>

        <div className="space-y-6">
          <ActiveRuntimeImageCard />
          <BuildHistoryCard />
        </div>
      </div>
    </div>
  );
}
