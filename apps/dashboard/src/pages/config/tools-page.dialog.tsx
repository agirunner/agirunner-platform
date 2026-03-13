import { Loader2 } from 'lucide-react';

import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  describeToolCategory,
  TOOL_CATEGORIES,
  type CreateToolForm,
  type EditToolForm,
  type ToolValidation,
} from './tools-page.support.js';
import { ConfigField } from './config-form-controls.js';

interface CreateToolDialogProps {
  mode: 'create';
  open: boolean;
  form: CreateToolForm;
  validation: ToolValidation;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(): void;
  onNameChange(value: string): void;
  onIdChange(value: string): void;
  onDescriptionChange(value: string): void;
  onCategoryChange(value: CreateToolForm['category']): void;
}

interface EditToolDialogProps {
  mode: 'edit';
  toolId: string;
  open: boolean;
  form: EditToolForm;
  validation: ToolValidation;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onSubmit(): void;
  onNameChange(value: string): void;
  onDescriptionChange(value: string): void;
  onCategoryChange(value: EditToolForm['category']): void;
}

type ToolDialogProps = CreateToolDialogProps | EditToolDialogProps;

export function ToolDialog(props: ToolDialogProps) {
  const isEdit = props.mode === 'edit';
  const categoryDescriptor = describeToolCategory(props.form.category);
  const title = isEdit ? 'Edit Tool' : 'Add Tool';
  const description = isEdit
    ? 'Update the tool catalog entry. The tool ID cannot be changed after creation.'
    : 'Create a shared tool catalog entry with clear operator-facing naming, category, and usage guidance.';
  const submitLabel = isEdit ? 'Save Changes' : 'Create Tool';

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!props.validation.isValid) {
              return;
            }
            props.onSubmit();
          }}
        >
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <Card>
              <CardHeader>
                <CardTitle>Tool details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <ConfigField
                  fieldId="tool-name"
                  label="Name"
                  description="Use the operator-facing tool name shown when access is granted."
                  error={props.validation.fieldErrors.name}
                >
                  {({ describedBy, isInvalid }) => (
                    <Input
                      id="tool-name"
                      value={props.form.name}
                      onChange={(event) => props.onNameChange(event.target.value)}
                      placeholder="Code formatter"
                      aria-invalid={isInvalid}
                      aria-describedby={describedBy}
                      data-testid="tool-name-input"
                    />
                  )}
                </ConfigField>
                {isEdit ? (
                  <ConfigField
                    fieldId="tool-id"
                    label="ID"
                    description="Tool IDs are fixed after creation so grants and audit trails stay stable."
                  >
                    {({ describedBy }) => (
                      <Input
                        id="tool-id"
                        value={props.toolId}
                        disabled
                        aria-describedby={describedBy}
                        className="bg-muted/30"
                        data-testid="tool-id-input"
                      />
                    )}
                  </ConfigField>
                ) : (
                  <ConfigField
                    fieldId="tool-id"
                    label="ID"
                    description="Use lowercase letters, numbers, and underscores so the ID remains safe in policy and runtime surfaces."
                    error={props.validation.fieldErrors.id}
                  >
                    {({ describedBy, isInvalid }) => (
                      <Input
                        id="tool-id"
                        value={props.form.id}
                        onChange={(event) => props.onIdChange(event.target.value)}
                        placeholder="code_formatter"
                        aria-invalid={isInvalid}
                        aria-describedby={describedBy}
                        data-testid="tool-id-input"
                      />
                    )}
                  </ConfigField>
                )}
                <ConfigField
                  fieldId="tool-category"
                  label="Category"
                  description={categoryDescriptor.detail}
                >
                  {({ describedBy }) => (
                    <Select
                      value={props.form.category}
                      onValueChange={(value) =>
                        props.onCategoryChange(value as CreateToolForm['category'])
                      }
                    >
                      <SelectTrigger
                        id="tool-category"
                        aria-describedby={describedBy}
                        data-testid="tool-category-select"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TOOL_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {describeToolCategory(category).label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </ConfigField>
                <ConfigField
                  fieldId="tool-description"
                  label="Description"
                  description="Explain when this tool should be granted and what an operator can expect it to do."
                >
                  {({ describedBy }) => (
                    <Input
                      id="tool-description"
                      value={props.form.description}
                      onChange={(event) => props.onDescriptionChange(event.target.value)}
                      placeholder="Explain when this tool should be granted"
                      aria-describedby={describedBy}
                      data-testid="tool-description-input"
                    />
                  )}
                </ConfigField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Save readiness</CardTitle>
                <CardDescription>
                  Resolve blockers before {isEdit ? 'saving changes' : 'adding the tool'} to the shared catalog.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className={
                    props.validation.isValid
                      ? 'rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'
                      : 'rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300'
                  }
                >
                  <p className="font-medium">
                    {props.validation.isValid
                      ? isEdit ? 'Ready to save changes.' : 'Ready to create this tool.'
                      : 'Resolve these issues before saving.'}
                  </p>
                  {!props.validation.isValid ? (
                    <ul className="mt-2 space-y-1">
                      {props.validation.blockingIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {props.validation.advisoryIssues.length > 0 ? (
                  <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
                    <p className="font-medium text-foreground">Recommended before launch</p>
                    <ul className="mt-2 space-y-1">
                      {props.validation.advisoryIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Selected category
                  </p>
                  <p className="mt-1 text-sm text-foreground">{categoryDescriptor.label}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="border-t border-border/70 bg-surface/95 px-6 py-4 backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted">
                {props.validation.isValid
                  ? isEdit ? 'Changes are ready to save.' : 'The tool is ready to add to the shared catalog.'
                  : `${props.validation.blockingIssues.length} save blocker${props.validation.blockingIssues.length === 1 ? '' : 's'} remaining.`}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={props.isPending || !props.validation.isValid}
                  data-testid="submit-tool"
                >
                  {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {submitLabel}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** @deprecated Use ToolDialog with mode='create' instead */
export const CreateToolDialog = ToolDialog;
