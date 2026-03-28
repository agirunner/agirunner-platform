import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  validateContainerCpu,
  validateContainerImage,
  validateContainerMemory,
} from '../../lib/container-resources.validation.js';
import type { DashboardExecutionEnvironmentPullPolicy } from '../../lib/api.js';
import type { ExecutionEnvironmentFormState } from './execution-environments-page.support.js';

const PULL_POLICY_OPTIONS: DashboardExecutionEnvironmentPullPolicy[] = [
  'always',
  'if-not-present',
  'never',
];

interface ValidationErrors {
  name?: string;
  image?: string;
  cpu?: string;
  memory?: string;
}

export function ExecutionEnvironmentDialog(props: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  form: ExecutionEnvironmentFormState;
  isPending: boolean;
  mutationError?: string | null;
  onFormChange: (next: ExecutionEnvironmentFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const validationErrors = useMemo(() => validateForm(props.form), [props.form]);
  const isValid = Object.keys(validationErrors).length === 0;

  useEffect(() => {
    if (!props.open) {
      setHasAttemptedSubmit(false);
    }
  }, [props.open]);

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValid) {
              setHasAttemptedSubmit(true);
              return;
            }
            props.onSubmit();
          }}
        >
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Name</span>
            <Input
              value={props.form.name}
              onChange={(event) => props.onFormChange({ ...props.form, name: event.target.value })}
              aria-invalid={Boolean(hasAttemptedSubmit && validationErrors.name)}
            />
            {hasAttemptedSubmit && validationErrors.name ? (
              <span className="text-xs text-red-600 dark:text-red-400">{validationErrors.name}</span>
            ) : null}
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Description</span>
            <Input
              value={props.form.description}
              onChange={(event) =>
                props.onFormChange({ ...props.form, description: event.target.value })
              }
              placeholder="Operator-facing description"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Image</span>
            <Input
              value={props.form.image}
              onChange={(event) =>
                props.onFormChange({ ...props.form, image: event.target.value })
              }
              placeholder="ghcr.io/customer/dev:1.2.3"
              aria-invalid={Boolean(hasAttemptedSubmit && validationErrors.image)}
            />
            {hasAttemptedSubmit && validationErrors.image ? (
              <span className="text-xs text-red-600 dark:text-red-400">{validationErrors.image}</span>
            ) : null}
          </label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">CPU</span>
              <Input
                value={props.form.cpu}
                onChange={(event) => props.onFormChange({ ...props.form, cpu: event.target.value })}
                aria-invalid={Boolean(hasAttemptedSubmit && validationErrors.cpu)}
              />
              {hasAttemptedSubmit && validationErrors.cpu ? (
                <span className="text-xs text-red-600 dark:text-red-400">{validationErrors.cpu}</span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Memory</span>
              <Input
                value={props.form.memory}
                onChange={(event) =>
                  props.onFormChange({ ...props.form, memory: event.target.value })
                }
                aria-invalid={Boolean(hasAttemptedSubmit && validationErrors.memory)}
              />
              {hasAttemptedSubmit && validationErrors.memory ? (
                <span className="text-xs text-red-600 dark:text-red-400">{validationErrors.memory}</span>
              ) : null}
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Pull policy</span>
              <Select
                value={props.form.pullPolicy}
                onValueChange={(pullPolicy) =>
                  props.onFormChange({
                    ...props.form,
                    pullPolicy: pullPolicy as DashboardExecutionEnvironmentPullPolicy,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select pull policy" />
                </SelectTrigger>
                <SelectContent>
                  {PULL_POLICY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Operator notes</span>
            <Textarea
              rows={4}
              value={props.form.operatorNotes}
              onChange={(event) =>
                props.onFormChange({ ...props.form, operatorNotes: event.target.value })
              }
              placeholder="Document expected tooling, install posture, or caveats for operators."
            />
          </label>
          {props.mutationError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{props.mutationError}</p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={props.isPending}>
              {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function validateForm(form: ExecutionEnvironmentFormState): ValidationErrors {
  const errors: ValidationErrors = {};

  if (!form.name.trim()) {
    errors.name = 'Enter an environment name.';
  }

  const imageError = validateContainerImage(form.image, 'Image');
  if (imageError) {
    errors.image = imageError;
  } else if (!form.image.trim()) {
    errors.image = 'Enter a container image reference.';
  }

  const cpuError = validateContainerCpu(form.cpu, 'CPU');
  if (cpuError) {
    errors.cpu = cpuError;
  } else if (!form.cpu.trim()) {
    errors.cpu = 'Enter a CPU allocation.';
  }

  const memoryError = validateContainerMemory(form.memory, 'Memory');
  if (memoryError) {
    errors.memory = memoryError;
  } else if (!form.memory.trim()) {
    errors.memory = 'Enter a memory allocation.';
  }

  return errors;
}
