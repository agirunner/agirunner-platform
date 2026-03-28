import { AlertCircle } from 'lucide-react';

import { cn } from '../../lib/utils.js';

export const DEFAULT_FORM_VALIDATION_MESSAGE = 'Fix the highlighted fields before continuing.';

export function FieldErrorText(props: {
  message?: string | null;
  id?: string;
  className?: string;
}): JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return (
    <p
      id={props.id}
      className={cn(
        'flex items-start gap-2 text-xs leading-5 text-red-600 dark:text-red-400',
        props.className,
      )}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{props.message}</span>
    </p>
  );
}

export function FormFeedbackMessage(props: {
  message?: string | null;
  className?: string;
}): JSX.Element | null {
  if (!props.message) {
    return null;
  }

  return (
    <div
      className={cn(
        'rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
        props.className,
      )}
    >
      {props.message}
    </div>
  );
}

export function resolveFormFeedbackMessage(input: {
  serverError?: string | null;
  showValidation: boolean;
  isValid: boolean;
  validationMessage?: string;
}): string | null {
  if (input.serverError) {
    return input.serverError;
  }

  if (input.showValidation && !input.isValid) {
    return input.validationMessage ?? DEFAULT_FORM_VALIDATION_MESSAGE;
  }

  return null;
}
