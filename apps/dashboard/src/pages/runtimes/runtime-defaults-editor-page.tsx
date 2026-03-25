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
  planRuntimeDefaultSaveAction,
} from './runtime-defaults.form.js';
import { fieldsForSection } from './runtime-defaults.schema.js';
import type {
  FieldDefinition,
  FormValues,
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
  sectionIdPrefix: string;
  successMessage: string;
  errorLabel: string;
}

function buildSaveOperations(
  values: FormValues,
  defaultsByKey: Map<string, { id: string; config_value?: string }>,
  fieldDefinitions: FieldDefinition[],
  primarySectionKeys: readonly string[],
): Promise<void>[] {
  return fieldDefinitions.flatMap((field) => {
    const value = (values[field.key] ?? '').trim();
    const existing = defaultsByKey.get(field.key);
    const saveAction = planRuntimeDefaultSaveAction({
      field,
      currentValue: value,
      existingValue: existing?.config_value,
      primarySectionKeys,
    });
    if (saveAction === 'delete') {
      return existing ? [deleteRuntimeDefault(existing.id)] : [];
    }
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
  const [isAdvancedExpanded, setAdvancedExpanded] = useState(false);

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
  const primarySections = useMemo(
    () =>
      props.sectionDefinitions.filter((section) => primarySectionKeys.has(section.key)),
    [primarySectionKeys, props.sectionDefinitions],
  );
  const advancedSections = useMemo(
    () =>
      props.sectionDefinitions.filter((section) => !primarySectionKeys.has(section.key)).map(
        (section) => ({
          ...section,
          fields: fieldsForSection(section.key, props.fieldDefinitions),
          configuredCount: sectionSummaryByKey.get(section.key)?.configuredCount ?? 0,
          fieldCount: sectionSummaryByKey.get(section.key)?.fieldCount ?? 0,
          errorCount: sectionSummaryByKey.get(section.key)?.errorCount ?? 0,
        }),
      ),
    [primarySectionKeys, props.fieldDefinitions, props.sectionDefinitions, sectionSummaryByKey],
  );

  useUnsavedChanges(isDirty);

  useEffect(() => {
    setFormValues(buildFormValues(data, props.fieldDefinitions, props.primarySectionKeys));
    setIsDirty(false);
  }, [data, props.fieldDefinitions, props.primarySectionKeys]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        buildSaveOperations(
          formValues,
          defaultsByKey,
          props.fieldDefinitions,
          props.primarySectionKeys,
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
    setFormValues(buildFormValues(data, props.fieldDefinitions, props.primarySectionKeys));
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

      <div className="grid gap-6 xl:grid-cols-2">
        {primarySections.map((section) => {
          const summary = sectionSummaryByKey.get(section.key);
          return (
            <section key={section.key} id={`${props.sectionIdPrefix}-${section.key}`}>
              <RuntimeDefaultsSection
                title={section.title}
                description={section.description}
                fields={fieldsForSection(section.key, props.fieldDefinitions)}
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
