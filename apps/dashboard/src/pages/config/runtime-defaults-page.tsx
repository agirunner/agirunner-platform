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
import { RuntimeDefaultsSection } from './runtime-defaults-fields.js';
import { buildDefaultsByKey, buildFormValues } from './runtime-defaults.form.js';
import { FIELD_DEFINITIONS, fieldsForSection, SECTION_DEFINITIONS } from './runtime-defaults.schema.js';
import type { FormValues } from './runtime-defaults.types.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import {
  ActiveRuntimeImageCard,
  BuildHistoryCard,
  RuntimeManagementCard,
} from './runtimes-build-history.js';
import { summarizeRuntimeDefaultSections } from './runtime-defaults-page.support.js';

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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () =>
      new Set(
        SECTION_DEFINITIONS.filter((section) => section.defaultExpanded).map(
          (section) => section.key,
        ),
      ),
  );

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

  function toggleSection(sectionKey: string): void {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
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
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-muted" />
              <CardTitle className="text-2xl">Runtimes</CardTitle>
            </div>
            <CardDescription className="text-sm leading-6">
              Configure platform-wide defaults for specialist runtime containers, specialist
              execution containers, context compaction, safeguards, and capacity limits.
              New containers pick up these defaults as they start. Clear a value and save to
              fall back to the system default.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      {SECTION_DEFINITIONS.map((section) => {
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
              isExpanded={expandedSections.has(section.key)}
              onToggle={() => toggleSection(section.key)}
              onChange={updateField}
            />
          </section>
        );
      })}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <RuntimeManagementCard />
        <div className="space-y-6">
          <ActiveRuntimeImageCard />
          <BuildHistoryCard />
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/90">
        <div className="space-y-1">
          <p className="text-sm font-medium">Save runtime defaults</p>
          <p className="text-sm text-muted">
            {hasValidationErrors
              ? `${Object.keys(validationErrors).length} field issue${Object.keys(validationErrors).length === 1 ? '' : 's'} must be resolved before saving.`
              : isDirty
                ? 'Unsaved runtime changes are ready to apply.'
                : 'No unsaved runtime changes.'}
          </p>
          <p className="text-sm text-muted">
            New specialist runtimes and execution containers pick up updated defaults as they start. Running work is not interrupted automatically.
          </p>
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
    </div>
  );
}
