import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, Server } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import { Card, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { toast } from '../../lib/toast.js';
import {
  deleteRuntimeDefault,
  fetchRuntimeDefaults,
  upsertRuntimeDefault,
} from './runtime-defaults.api.js';
import { RuntimeDefaultsSection } from './runtime-defaults-fields.js';
import { buildDefaultsByKey, buildFormValues } from './runtime-defaults.form.js';
import { FIELD_DEFINITIONS, fieldsForSection, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import { ActiveRuntimeImageCard, BuildHistoryCard } from './runtimes-build-history.js';

function buildSaveOperations(
  values: FormValues,
  defaultsByKey: Map<string, { id: string }>,
): Promise<void>[] {
  return FIELD_DEFINITIONS.flatMap((field) => {
    const value = (values[field.key] ?? '').trim();
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
}

export function RuntimeDefaultsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['runtime-defaults'],
    queryFn: fetchRuntimeDefaults,
  });
  const [formValues, setFormValues] = useState<FormValues>({});
  const [isDirty, setIsDirty] = useState(false);

  const defaultsByKey = useMemo(() => buildDefaultsByKey(data), [data]);
  const validationErrors = useMemo(() => buildValidationErrors(formValues), [formValues]);
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  useEffect(() => {
    setFormValues(buildFormValues(data));
    setIsDirty(false);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(buildSaveOperations(formValues, defaultsByKey));
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

  function saveForm(): void {
    if (hasValidationErrors) {
      toast.error('Resolve the highlighted runtime settings before saving.');
      return;
    }
    saveMutation.mutate();
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
                  Configure platform-wide runtime defaults for agent containers, context
                  compaction, recovery safeguards, and fleet limits. Playbooks can override
                  these values when they need a different execution posture. Clear a value and
                  save to fall back to the platform default.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={resetForm} disabled={!isDirty || saveMutation.isPending}>
                  <RotateCcw className="h-4 w-4" />
                  Reset changes
                </Button>
                <Button
                  onClick={saveForm}
                  disabled={!isDirty || saveMutation.isPending || hasValidationErrors}
                >
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

          {SECTION_DEFINITIONS.map((section) => (
            <RuntimeDefaultsSection
              key={section.key}
              title={section.title}
              description={section.description}
              fields={fieldsForSection(section.key)}
              values={formValues}
              errors={validationErrors}
              onChange={updateField}
            />
          ))}
        </div>

        <div className="space-y-6">
          <ActiveRuntimeImageCard />
          <BuildHistoryCard />
        </div>
      </div>
    </div>
  );
}
