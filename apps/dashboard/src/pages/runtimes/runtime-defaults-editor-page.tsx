import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save } from 'lucide-react';

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
  title: string;
  description: string;
  icon: ElementType;
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

  const Icon = props.icon;

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

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-muted" />
                <CardTitle className="text-2xl">{props.title}</CardTitle>
              </div>
              <CardDescription className="text-sm leading-6">
                {props.description}
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

      {primarySections.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {primarySections.map((section) => renderSectionCard(section))}
        </div>
      ) : null}

      {inlineSectionColumns ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            {inlineSectionColumns.left.map((section) => renderSectionCard(section))}
          </div>
          <div className="space-y-6">
            {inlineSectionColumns.right.map((section) => renderSectionCard(section))}
          </div>
        </div>
      ) : remainingSections.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {remainingSections.map((section) => renderSectionCard(section))}
        </div>
      ) : null}
    </div>
  );
}
