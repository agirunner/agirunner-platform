import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RotateCcw, Save } from 'lucide-react';

import { DashboardPageHeader } from '../../components/layout/dashboard-page-header.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
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
  headerDescriptionClassName?: string;
  fieldDefinitions: FieldDefinition[];
  sectionDefinitions: SectionDefinition[];
  primarySectionKeys: readonly string[];
  inlineSectionColumns?: SectionColumnLayout;
  sectionIdPrefix: string;
  successMessage: string;
  errorLabel: string;
  sectionSupplementalContent?: Partial<Record<SectionDefinition['key'], ReactNode>>;
  additionalHasChanges?: boolean;
  additionalHasValidationErrors?: boolean;
  onResetAdditional?(): void;
  onSaveAdditional?(): Promise<void>;
}

interface RenderableSection extends SectionDefinition {
  fields: FieldDefinition[];
  configuredCount: number;
  fieldCount: number;
  errorCount: number;
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const defaultsByKey = useMemo(() => buildDefaultsByKey(data), [data]);
  const validationErrors = useMemo(
    () => buildValidationErrors(formValues, props.fieldDefinitions),
    [formValues, props.fieldDefinitions],
  );
  const visibleValidationErrors = useMemo(
    () => (hasAttemptedSubmit ? validationErrors : {}),
    [hasAttemptedSubmit, validationErrors],
  );
  const sectionSummaries = useMemo(
    () =>
      summarizeRuntimeDefaultSections(
        formValues,
        visibleValidationErrors,
        props.sectionDefinitions,
        props.fieldDefinitions,
      ),
    [formValues, visibleValidationErrors, props.fieldDefinitions, props.sectionDefinitions],
  );
  const sectionSummaryByKey = useMemo(
    () => new Map(sectionSummaries.map((section) => [section.key, section])),
    [sectionSummaries],
  );
  const hasValidationErrors =
    Object.keys(validationErrors).length > 0 || Boolean(props.additionalHasValidationErrors);
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

  const hasAnyChanges = isDirty || Boolean(props.additionalHasChanges);

  useUnsavedChanges(hasAnyChanges);

  useEffect(() => {
    setFormValues(buildFormValues(data, props.fieldDefinitions));
    setIsDirty(false);
    setHasAttemptedSubmit(false);
  }, [data, props.fieldDefinitions]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(
        [
          ...buildSaveOperations(
            formValues,
            defaultsByKey,
            props.fieldDefinitions,
          ),
          ...(props.onSaveAdditional && props.additionalHasChanges
            ? [props.onSaveAdditional()]
            : []),
        ],
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['runtime-defaults'] });
      setIsDirty(false);
      setHasAttemptedSubmit(false);
      toast.success(props.successMessage);
    },
  });

  function updateField(key: string, value: string): void {
    saveMutation.reset();
    setFormValues((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
  }

  function resetForm(): void {
    saveMutation.reset();
    setFormValues(buildFormValues(data, props.fieldDefinitions));
    setIsDirty(false);
    setHasAttemptedSubmit(false);
    props.onResetAdditional?.();
  }

  function saveForm(): void {
    if (hasValidationErrors) {
      setHasAttemptedSubmit(true);
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

  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError:
      saveMutation.error instanceof Error
        ? `Failed to save ${props.errorLabel}: ${saveMutation.error.message}`
        : saveMutation.error
          ? `Failed to save ${props.errorLabel}.`
          : null,
    showValidation: hasAttemptedSubmit,
    isValid: !hasValidationErrors,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  function renderSectionCard(section: RenderableSection): JSX.Element {
    return (
      <section key={section.key} id={`${props.sectionIdPrefix}-${section.key}`}>
        <RuntimeDefaultsSection
          title={section.title}
          description={section.description}
          fields={section.fields}
          values={formValues}
          errors={visibleValidationErrors}
          configuredCount={section.configuredCount}
          fieldCount={section.fieldCount}
          errorCount={section.errorCount}
          supplementalContent={props.sectionSupplementalContent?.[section.key]}
          onChange={updateField}
        />
      </section>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardPageHeader
        navHref={props.navHref}
        description={props.description}
        descriptionClassName={props.headerDescriptionClassName}
        actions={
          <>
            <Button
              variant="outline"
              onClick={resetForm}
              disabled={!hasAnyChanges || saveMutation.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              Reset changes
            </Button>
            <Button
              onClick={saveForm}
              disabled={!hasAnyChanges || saveMutation.isPending}
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
      <FormFeedbackMessage message={formFeedbackMessage} />

      {leftColumnSections && rightColumnSections ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="space-y-6">
            {leftColumnSections.map((section) => renderSectionCard(section))}
          </div>
          <div className="space-y-6">
            {rightColumnSections.map((section) => renderSectionCard(section))}
          </div>
        </div>
      ) : primarySections.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {primarySections.map((section) => renderSectionCard(section))}
        </div>
      ) : remainingSections.length > 0 ? (
        <div className="grid gap-6 xl:grid-cols-2">
          {remainingSections.map((section) => renderSectionCard(section))}
        </div>
      ) : null}
    </div>
  );
}
