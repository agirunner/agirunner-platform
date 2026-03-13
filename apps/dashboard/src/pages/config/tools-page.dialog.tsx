import type { ReactNode } from 'react';

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
  type ToolValidation,
} from './tools-page.support.js';

export function CreateToolDialog(props: {
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
}) {
  const categoryDescriptor = describeToolCategory(props.form.category);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <DialogTitle>Add Tool</DialogTitle>
          <DialogDescription>
            Create a shared tool catalog entry with clear operator-facing naming, category, and usage guidance.
          </DialogDescription>
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
                <Field label="Name" error={props.validation.fieldErrors.name}>
                  <Input
                    value={props.form.name}
                    onChange={(event) => props.onNameChange(event.target.value)}
                    placeholder="Code formatter"
                    aria-invalid={Boolean(props.validation.fieldErrors.name)}
                    data-testid="tool-name-input"
                  />
                </Field>
                <Field label="ID" error={props.validation.fieldErrors.id}>
                  <Input
                    value={props.form.id}
                    onChange={(event) => props.onIdChange(event.target.value)}
                    placeholder="code_formatter"
                    aria-invalid={Boolean(props.validation.fieldErrors.id)}
                    data-testid="tool-id-input"
                  />
                </Field>
                <Field label="Category">
                  <Select
                    value={props.form.category}
                    onValueChange={(value) =>
                      props.onCategoryChange(value as CreateToolForm['category'])
                    }
                  >
                    <SelectTrigger data-testid="tool-category-select">
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
                  <p className="text-xs text-muted">{categoryDescriptor.detail}</p>
                </Field>
                <Field label="Description">
                  <Input
                    value={props.form.description}
                    onChange={(event) => props.onDescriptionChange(event.target.value)}
                    placeholder="Explain when this tool should be granted"
                    data-testid="tool-description-input"
                  />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Save readiness</CardTitle>
                <CardDescription>
                  Resolve blockers before adding the tool to the shared catalog.
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
                      ? 'Ready to create this tool.'
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
                  ? 'The tool is ready to add to the shared catalog.'
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
                  Create Tool
                </Button>
              </div>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field(props: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      {props.children}
      {props.error ? <span className="text-xs text-red-600">{props.error}</span> : null}
    </label>
  );
}
