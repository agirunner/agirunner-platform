import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
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
  fetchRuntimeDefaults,
  upsertRuntimeDefault,
} from './runtime-defaults.api.js';
import {
  RuntimeDefaultsSection,
} from './runtime-defaults-fields.js';
import {
  buildDefaultsByKey,
  buildFormValues,
  planRuntimeDefaultSaveAction,
} from './runtime-defaults.form.js';
import { fieldsForSection } from './runtime-defaults.schema.js';
import type {
  FieldDefinition,
  FormValues,
  SectionColumnLayout,
  SectionDefinition,
} from './runtime-defaults.types.js';
import { buildValidationErrors } from './runtime-defaults.validation.js';
import { summarizeRuntimeDefaultSections } from './runtime-defaults-page.support.js';

interface RuntimeDefaultsEditorPageProps {
  navHref: string;
  description: string;
  fieldDefinitions: FieldDefinition[];
  sectionDefinitions: SectionDefinition[];
  primarySectionKeys: readonly string[];
  inlineSectionColumns?: SectionColumnLayout;
  sectionIdPrefix: string;
  successMessage: string;
  errorLabel: string;
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function buildSaveOperations(
  values: FormValues,
  defaultsByKey: Map<string, { id: string; config_value?: string }>,
  fieldDefinitions: FieldDefinition[],
): Promise<void>[] {
  return fieldDefinitions.flatMap((field) => {
    const value = (values[field.key] ?? '').trim();
    const existing = defaultsByKey.get(field.key);
    const saveAction = planRuntimeDefaultSaveAction({
      field,
      currentValue: value,
      existingValue: existing?.config_value,
    });
    if (saveAction === 'noop') {
      return [];
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

export function RuntimeDefaultsEditorPage(props: RuntimeDefaultsEditorPageProps): JSX.Element {
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ['runtime-defaults'],
    queryFn: fetchRuntimeDefaults,
  });
  const [formValues, setFormValues] = useState<FormValues>({});
  const [isDirty, setIsDirty] = useState(false);

  const defaultsByKey = useMemo(() => buildDefaultsByKey(data), [data]);
  const validationErrors = useMemo(
    () => buildValidationErrors(formValues, props.fieldDefinitions),
    [formValues, props.fieldDefinitions],
  );
  const sectionSummaries = useMemo(
    () =>
      summarizeRuntimeDefaultSections(
        formValues,
        validationErrors,
        props.sectionDefinitions,
        props.fieldDefinitions,
      ),
    [formValues, validationErrors, props.fieldDefinitions, props.sectionDefinitions],
  );
  const sectionSummaryByKey = useMemo(
    () => new Map(sectionSummaries.map((section) => [section.key, section])),
    [sectionSummaries],
  );
  const hasValidationErrors = Object.keys(validationErrors).length > 0;
  const primarySectionKeys = useMemo(
    () => new Set<string>(props.primarySectionKeys),
    [props.primarySectionKeys],
  );
  const renderableSectionsByKey = useMemo(
    () =>
      new Map(
        props.sectionDefinitions.map((section) => [
          section.key,
          {
            ...section,
            fields: fieldsForSection(section.key, props.fieldDefinitions),
            configuredCount: sectionSummaryByKey.get(section.key)?.configuredCount ?? 0,
            fieldCount: sectionSummaryByKey.get(section.key)?.fieldCount ?? 0,
            errorCount: sectionSummaryByKey.get(section.key)?.errorCount ?? 0,
          },
        ]),
      ),
    [props.fieldDefinitions, props.sectionDefinitions, sectionSummaryByKey],
  );
  const primarySections = useMemo(
    () =>
      props.sectionDefinitions
        .filter((section) => primarySectionKeys.has(section.key))
        .map((section) => renderableSectionsByKey.get(section.key) ?? null)
        .filter(isDefined),
    [primarySectionKeys, props.sectionDefinitions, renderableSectionsByKey],
  );
  const remainingSections = useMemo(
    () =>
      props.sectionDefinitions
        .filter((section) => !primarySectionKeys.has(section.key))
        .map((section) => renderableSectionsByKey.get(section.key) ?? null)
        .filter(isDefined),
    [primarySectionKeys, props.sectionDefinitions, renderableSectionsByKey],
  );
  const inlineSectionColumns = useMemo(() => {
    if (!props.inlineSectionColumns) {
      return null;
    }
    return {
      left: props.inlineSectionColumns.left
        .map((key) => renderableSectionsByKey.get(key) ?? null)
        .filter(isDefined),
      right: props.inlineSectionColumns.right
        .map((key) => renderableSectionsByKey.get(key) ?? null)
        .filter(isDefined),
    };
  }, [props.inlineSectionColumns, renderableSectionsByKey]);
  const leftColumnSections = useMemo(() => {
    if (!inlineSectionColumns) {
      return null;
    }
    return [
      ...primarySections.filter((_, index) => index % 2 === 0),
      ...inlineSectionColumns.left,
    ];
  }, [inlineSectionColumns, primarySections]);
  const rightColumnSections = useMemo(() => {
    if (!inlineSectionColumns) {
      return null;
    }
    return [
      ...primarySections.filter((_, index) => index % 2 === 1),
      ...inlineSectionColumns.right,
    ];
  }, [inlineSectionColumns, primarySections]);
  const configuredFieldCount = useMemo(
    () => sectionSummaries.reduce((total, section) => total + section.configuredCount, 0),
    [sectionSummaries],
  );
  const totalFieldCount = useMemo(
    () => sectionSummaries.reduce((total, section) => total + section.fieldCount, 0),
    [sectionSummaries],
  );
  const sectionsWithErrors = useMemo(
    () => sectionSummaries.filter((section) => section.errorCount > 0).length,
    [sectionSummaries],
  );

  useUnsavedChanges(isDirty);

  useEffect(() => {
    setFormValues(buildFormValues(data, props.fieldDefinitions));
    setIsDirty(false);
  }, [data, props.fieldDefinitions]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        buildSaveOperations(
          formValues,
          defaultsByKey,
          props.fieldDefinitions,
        ),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      setIsDirty(false);
      toast.success(props.successMessage);
    },
    onError: (errorValue) => {
      const message = errorValue instanceof Error ? errorValue.message : String(errorValue);
      toast.error(`Failed to save ${props.errorLabel}: ${message}`);
    },
  });

  function updateField(key: string, value: string): void {
    setFormValues((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
  }

  function resetForm(): void {
    setFormValues(buildFormValues(data, props.fieldDefinitions));
    setIsDirty(false);
  }

  function saveForm(): void {
    if (hasValidationErrors) {
      toast.error(`Resolve the highlighted ${props.errorLabel} settings before saving.`);
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
          Failed to load {props.errorLabel}: {String(error)}
        </div>
      </div>
    );
  }

  function renderSectionCard(section: {
    key: string;
    title: string;
    description: string;
    fields: FieldDefinition[];
    configuredCount: number;
    fieldCount: number;
    errorCount: number;
  }): JSX.Element {
    return (
      <section key={section.key} id={`${props.sectionIdPrefix}-${section.key}`}>
        <RuntimeDefaultsSection
          title={section.title}
          description={section.description}
          fields={section.fields}
          values={formValues}
          errors={validationErrors}
          configuredCount={section.configuredCount}
          fieldCount={section.fieldCount}
          errorCount={section.errorCount}
          onChange={updateField}
        />
      </section>
    );
  }

  function renderPrimaryAsideCard(): JSX.Element {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configuration status</CardTitle>
          <CardDescription>
            Keep the specialist agent defaults aligned with the rest of the runtime settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <StatusFact
            label="Configured defaults"
            value={`${configuredFieldCount} / ${totalFieldCount}`}
          />
          <StatusFact
            label="Sections with issues"
            value={sectionsWithErrors === 0 ? '0' : String(sectionsWithErrors)}
            tone={sectionsWithErrors > 0 ? 'warning' : 'default'}
          />
          <StatusFact
            label="Unsaved changes"
            value={isDirty ? 'Pending save' : 'No pending edits'}
            tone={isDirty ? 'warning' : 'default'}
          />
          <p className="text-sm leading-6 text-muted">
            Specialist execution environments are configured separately on Platform &gt; Environments.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref={props.navHref}
        description={props.description}
        actions={
          <>
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
          </>
        }
      />

      {leftColumnSections && rightColumnSections ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            {leftColumnSections.map((section) => renderSectionCard(section))}
          </div>
          <div className="space-y-6">
            {primarySections.length === 1 ? renderPrimaryAsideCard() : null}
            {rightColumnSections.map((section) => renderSectionCard(section))}
          </div>
        </div>
      ) : primarySections.length > 0 ? (
        primarySections.length === 1 ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-6">
              {primarySections.map((section) => renderSectionCard(section))}
            </div>
            <div className="space-y-6">
              {renderPrimaryAsideCard()}
            </div>
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            {primarySections.map((section) => renderSectionCard(section))}
          </div>
        )
      ) : remainingSections.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {remainingSections.map((section) => renderSectionCard(section))}
        </div>
      ) : null}
    </div>
  );
}

function StatusFact(props: {
  label: string;
  value: string;
  tone?: 'default' | 'warning';
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">{props.label}</p>
      <p className={props.tone === 'warning' ? 'mt-2 text-lg font-semibold text-warning' : 'mt-2 text-lg font-semibold text-foreground'}>
        {props.value}
      </p>
    </div>
  );
}
