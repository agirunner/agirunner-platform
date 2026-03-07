import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Loader2, Save, Settings2 } from 'lucide-react';
import { readSession } from '../../lib/session.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface ConfigDefault {
  key: string;
  value: string;
  description?: string;
  category: string;
}

interface ConfigDefaults {
  [key: string]: unknown;
}

const CATEGORY_ORDER = [
  'Agent settings',
  'Queue settings',
  'Container settings',
  'Tool settings',
];

function categorizeDefaults(defaults: ConfigDefaults): ConfigDefault[] {
  const entries: ConfigDefault[] = [];

  for (const [key, value] of Object.entries(defaults)) {
    const category = inferCategory(key);
    entries.push({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
      description: inferDescription(key),
      category,
    });
  }

  return entries.sort((a, b) => {
    const aIdx = CATEGORY_ORDER.indexOf(a.category);
    const bIdx = CATEGORY_ORDER.indexOf(b.category);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });
}

function inferCategory(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes('agent') || lower.includes('model') || lower.includes('llm')) {
    return 'Agent settings';
  }
  if (lower.includes('queue') || lower.includes('concurrency') || lower.includes('retry')) {
    return 'Queue settings';
  }
  if (
    lower.includes('container') ||
    lower.includes('docker') ||
    lower.includes('image') ||
    lower.includes('memory') ||
    lower.includes('cpu')
  ) {
    return 'Container settings';
  }
  if (lower.includes('tool') || lower.includes('sandbox') || lower.includes('exec')) {
    return 'Tool settings';
  }
  return 'Agent settings';
}

function inferDescription(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function authHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function fetchDefaults(): Promise<ConfigDefaults> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

async function patchDefaults(payload: ConfigDefaults): Promise<ConfigDefaults> {
  const response = await fetch(`${API_BASE_URL}/api/v1/config/runtime-defaults`, {
    method: 'PATCH',
    headers: authHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

function SettingsCategory({
  category,
  entries,
  register,
}: {
  category: string;
  entries: ConfigDefault[];
  register: ReturnType<typeof useForm<Record<string, string>>>['register'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{category}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.map((entry) => (
          <div key={entry.key} className="grid grid-cols-3 gap-4 items-start">
            <div>
              <label
                htmlFor={entry.key}
                className="text-sm font-medium block"
              >
                {entry.description}
              </label>
              <span className="text-xs font-mono text-muted">{entry.key}</span>
            </div>
            <div className="col-span-2">
              <Input
                id={entry.key}
                {...register(entry.key)}
                className="font-mono text-sm"
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function RuntimesPage(): JSX.Element {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['config-defaults'],
    queryFn: fetchDefaults,
  });

  const entries = data ? categorizeDefaults(data) : [];

  const defaultValues: Record<string, string> = {};
  for (const entry of entries) {
    defaultValues[entry.key] = entry.value;
  }

  const { register, handleSubmit, reset } = useForm<Record<string, string>>({
    values: defaultValues,
  });

  const mutation = useMutation({
    mutationFn: (formData: Record<string, string>) => {
      const payload: ConfigDefaults = {};
      for (const [key, value] of Object.entries(formData)) {
        try {
          payload[key] = JSON.parse(value);
        } catch {
          payload[key] = value;
        }
      }
      return patchDefaults(payload);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['config-defaults'], updated);
      queryClient.invalidateQueries({ queryKey: ['config-defaults'] });
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

  if (entries.length === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Runtimes</h1>
          <p className="text-sm text-muted">
            Configure runtime defaults for task execution.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-muted">
          <Settings2 className="h-12 w-12 mb-4" />
          <p className="font-medium">No runtime defaults configured</p>
          <p className="text-sm mt-1">
            Defaults will appear once the platform provides configuration.
          </p>
        </div>
      </div>
    );
  }

  const grouped = new Map<string, ConfigDefault[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.category) ?? [];
    list.push(entry);
    grouped.set(entry.category, list);
  }

  const categoryList = [...grouped.entries()].sort(([a], [b]) => {
    const aIdx = CATEGORY_ORDER.indexOf(a);
    const bIdx = CATEGORY_ORDER.indexOf(b);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Runtimes</h1>
          <p className="text-sm text-muted">
            Configure runtime defaults for task execution.
          </p>
        </div>
        <Button
          onClick={handleSubmit((formData) => mutation.mutate(formData))}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>

      {mutation.isSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Runtime defaults saved successfully.
        </div>
      )}

      {mutation.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Failed to save: {String(mutation.error)}
        </div>
      )}

      <form className="space-y-6">
        {categoryList.map(([category, catEntries]) => (
          <SettingsCategory
            key={category}
            category={category}
            entries={catEntries}
            register={register}
          />
        ))}
      </form>
    </div>
  );
}
