import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save, Server } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { toast } from '../../lib/toast.js';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes.js';
import {
  deleteRuntimeDefault,
  fetchRuntimeDefaults,
  upsertRuntimeDefault,
} from './runtime-defaults.api.js';
import {
  RuntimeAdvancedSettingsSection,
  RuntimeDefaultsSection,
} from './runtime-defaults-fields.js';
import {
  buildDefaultsByKey,
  buildFormValues,
  isAdvancedRuntimeOverrideField,
} from './runtime-defaults.form.js';
import {
  FIELD_DEFINITIONS,
  fieldsForSection,
  PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS,
  SECTION_DEFINITIONS,
} from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import { summarizeRuntimeDefaultSections } from './runtime-defaults-page.support.js';

function buildSaveOperations(
  values: FormValues,
  defaultsByKey: Map<string, { id: string }>,
): Promise<void>[] {
  return FIELD_DEFINITIONS.flatMap((field) => {
    const value = (values[field.key] ?? '').trim();
    const existing = defaultsByKey.get(field.key);
    const shouldDelete =
      !value || (isAdvancedRuntimeOverrideField(field) && value === field.placeholder);
    if (shouldDelete) {
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
  const [isAdvancedExpanded, setAdvancedExpanded] = useState(false);

  const defaultsByKey = useMemo(() => buildDefaultsByKey(data), [data]);
  const validationErrors = useMemo(() => buildValidationErrors(formValues), [formValues]);
  const sectionSummaries = useMemo(
    () => summarizeRuntimeDefaultSections(formValues, validationErrors),
    [formValues, validationErrors],
  );
  const sectionSummaryByKey = useMemo(
    () => new Map(sectionSummaries.map((section) => [section.key, section])),
    [sectionSummaries],
  );
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const primarySectionKeys = useMemo(
    () => new Set<string>(PRIMARY_RUNTIME_DEFAULT_SECTION_KEYS),
    [],
  );
  const primarySections = useMemo(
    () =>
      SECTION_DEFINITIONS.filter((section) => primarySectionKeys.has(section.key)),
    [primarySectionKeys],
  );
  const advancedSections = useMemo(
    () =>
      SECTION_DEFINITIONS.filter((section) => !primarySectionKeys.has(section.key)).map(
        (section) => ({
          ...section,
          fields: fieldsForSection(section.key),
          configuredCount: sectionSummaryByKey.get(section.key)?.configuredCount ?? 0,
          fieldCount: sectionSummaryByKey.get(section.key)?.fieldCount ?? 0,
          errorCount: sectionSummaryByKey.get(section.key)?.errorCount ?? 0,
        }),
      ),
    [primarySectionKeys, sectionSummaryByKey],
  );

  useUnsavedChanges(isDirty);

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
      toast.success('Runtime configuration saved.');
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
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          Failed to load runtime configuration: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-muted" />
                <CardTitle className="text-2xl">Runtimes</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6">
                Configure platform-wide defaults for specialist runtime containers and execution
                containers. Everything else is optional and only overrides the built-in defaults
                when you set a value.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={resetForm}
                disabled={!isDirty || saveMutation.isPending}
              >
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
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {primarySections.map((section) => {
          const summary = sectionSummaryByKey.get(section.key);
          return (
            <section key={section.key} id={`runtime-defaults-${section.key}`}>
              <RuntimeDefaultsSection
                title={section.title}
                description={section.description}
                fields={fieldsForSection(section.key)}
                values={formValues}
                errors={validationErrors}
                configuredCount={summary?.configuredCount ?? 0}
                fieldCount={summary?.fieldCount ?? 0}
                errorCount={summary?.errorCount ?? 0}
                onChange={updateField}
              />
            </section>
          );
        })}
      </div>

      <RuntimeAdvancedSettingsSection
        sections={advancedSections}
        values={formValues}
        errors={validationErrors}
        isExpanded={isAdvancedExpanded}
        onToggle={() => setAdvancedExpanded((current) => !current)}
        onChange={updateField}
      />
    </div>
  );
}
