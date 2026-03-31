import { Button } from '../../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FieldErrorText,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../../components/forms/form-feedback.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';
import { Textarea } from '../../../components/ui/textarea.js';

export interface SkillFormState {
  name: string;
  summary: string;
  content: string;
}

export interface SkillFormValidation {
  isValid: boolean;
  fieldErrors: {
    name?: string;
    summary?: string;
    content?: string;
  };
}

export function createSkillFormState(
  skill?: { name: string; summary: string | null; content: string } | null,
): SkillFormState {
  return {
    name: skill?.name ?? '',
    summary: skill?.summary ?? '',
    content: skill?.content ?? '',
  };
}

export function validateSkillForm(form: SkillFormState): SkillFormValidation {
  const fieldErrors: SkillFormValidation['fieldErrors'] = {};

  if (!form.name.trim()) {
    fieldErrors.name = 'Enter a skill name.';
  }

  if (!form.summary.trim()) {
    fieldErrors.summary = 'Add a short summary.';
  }

  if (!form.content.trim()) {
    fieldErrors.content = 'Add the reusable skill content.';
  }

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
  };
}

export function SkillsPageDialog(props: {
  open: boolean;
  title: 'Create Skill' | 'Edit Skill';
  submitLabel: 'Create Skill' | 'Save Skill';
  form: SkillFormState;
  validation: SkillFormValidation;
  showValidationErrors: boolean;
  isPending: boolean;
  onOpenChange(open: boolean): void;
  onFormChange(next: SkillFormState): void;
  onSubmit(): void;
}) {
  const formFeedbackMessage = resolveFormFeedbackMessage({
    showValidation: props.showValidationErrors,
    isValid: props.validation.isValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[84rem] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>
            Maintain reusable skill content that can be assigned to specialists.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Name</span>
            <Input
              value={props.form.name}
              onChange={(event) => {
                props.onFormChange({ ...props.form, name: event.target.value });
              }}
              aria-invalid={Boolean(props.showValidationErrors && props.validation.fieldErrors.name)}
            />
            <FieldErrorText
              message={props.showValidationErrors ? props.validation.fieldErrors.name : undefined}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Summary</span>
            <Input
              value={props.form.summary}
              onChange={(event) => {
                props.onFormChange({ ...props.form, summary: event.target.value });
              }}
              aria-invalid={Boolean(
                props.showValidationErrors && props.validation.fieldErrors.summary,
              )}
            />
            <FieldErrorText
              message={props.showValidationErrors ? props.validation.fieldErrors.summary : undefined}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Content</span>
            <Textarea
              className="min-h-[640px] sm:min-h-[720px]"
              value={props.form.content}
              onChange={(event) => {
                props.onFormChange({ ...props.form, content: event.target.value });
              }}
              aria-invalid={Boolean(props.showValidationErrors && props.validation.fieldErrors.content)}
            />
            <FieldErrorText
              message={props.showValidationErrors ? props.validation.fieldErrors.content : undefined}
            />
          </label>
          <FormFeedbackMessage message={formFeedbackMessage} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.isPending}>
              {props.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
