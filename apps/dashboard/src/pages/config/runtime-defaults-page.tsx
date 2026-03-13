import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save, Server } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
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
import { ActiveRuntimeImageCard, BuildHistoryCard } from './runtimes-build-history.js';
import {
  summarizeRuntimeDefaults,
  summarizeRuntimeDefaultSections,
} from './runtime-defaults-page.support.js';

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
  const summaryCards = useMemo(
    () => summarizeRuntimeDefaults(formValues, validationErrors),
    [formValues, validationErrors],
  );
  const sectionSummaries = useMemo(
    () => summarizeRuntimeDefaultSections(formValues, validationErrors),
    [formValues, validationErrors],
  );
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const validationIssues = useMemo(
    () => [...new Set(Object.values(validationErrors))],
    [validationErrors],
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
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
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
              <div className="flex flex-wrap gap-2 xl:hidden">
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

          <div className="grid gap-4 md:grid-cols-3">
            {summaryCards.map((summary) => (
              <Card key={summary.label} className="border-border/70 shadow-sm">
                <CardHeader className="space-y-1">
                  <p className="text-sm font-medium text-muted">{summary.label}</p>
                  <CardTitle className="text-2xl">{summary.value}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted">{summary.detail}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {SECTION_DEFINITIONS.map((section) => (
            <section key={section.key} id={`runtime-defaults-${section.key}`}>
              <RuntimeDefaultsSection
                title={section.title}
                description={section.description}
                fields={fieldsForSection(section.key)}
                values={formValues}
                errors={validationErrors}
                onChange={updateField}
              />
            </section>
          ))}
        </div>

        <div className="space-y-6">
          <Card className="xl:sticky xl:top-6">
            <CardHeader>
              <CardTitle>Save readiness</CardTitle>
              <CardDescription>
                Track blocking validation, section coverage, and save actions while you configure runtime defaults.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={
                  hasValidationErrors
                    ? 'rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300'
                    : 'rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'
                }
              >
                <div className="flex items-start gap-3">
                  {hasValidationErrors ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <div>
                    <p className="font-medium">
                      {hasValidationErrors
                        ? 'Resolve these runtime issues before saving.'
                        : isDirty
                          ? 'Ready to save runtime defaults.'
                          : 'No unsaved runtime changes.'}
                    </p>
                    {hasValidationErrors ? (
                      <ul className="mt-2 space-y-1">
                        {validationIssues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Section outline
                </p>
                {sectionSummaries.map((section) => (
                  <a
                    key={section.key}
                    href={`#runtime-defaults-${section.key}`}
                    className="block rounded-lg border border-border/70 bg-muted/10 px-4 py-3 transition-colors hover:bg-muted/20"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{section.title}</p>
                      <span className="text-xs text-muted">
                        {section.configuredCount}/{section.fieldCount}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {section.errorCount > 0
                        ? `${section.errorCount} validation blocker${section.errorCount === 1 ? '' : 's'}`
                        : 'No validation blockers'}
                    </p>
                  </a>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={resetForm}
                  disabled={!isDirty || saveMutation.isPending}
                  className="flex-1"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset changes
                </Button>
                <Button
                  onClick={saveForm}
                  disabled={!isDirty || saveMutation.isPending || hasValidationErrors}
                  className="flex-1"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
          <ActiveRuntimeImageCard />
          <BuildHistoryCard />
        </div>
      </div>
    </div>
  );
}
