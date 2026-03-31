import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  dashboardApi,
  type DashboardDeleteImpactSummary,
  type DashboardWorkspaceRecord,
} from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
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
  DialogTrigger,
} from '../../../components/ui/dialog.js';
import { Input } from '../../../components/ui/input.js';

interface WorkspaceFormData {
  name: string;
  slug: string;
}

const INITIAL_FORM: WorkspaceFormData = {
  name: '',
  slug: '',
};

export function formatWorkspaceDialogError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '').trim();
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes('http 409')
    || normalizedMessage.includes('workspace slug already exists')
    || normalizedMessage.includes('slug already exists')
  ) {
    return 'That workspace slug already exists. Choose a different slug.';
  }

  return message;
}

export function formatWorkspaceDeleteError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? '')).trim();
  const normalized = message.replace(/^HTTP\s+\d+:\s*/i, '').trim();
  return normalized || 'Failed to delete workspace.';
}

export function CreateWorkspaceDialog(props?: {
  buttonLabel?: string;
  buttonClassName?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<WorkspaceFormData>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () =>
      dashboardApi.createWorkspace({
        name: form.name,
        slug: form.slug,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
      toast.success('Workspace created. Continue setup in the workspace workspace.');
      navigate(`/design/workspaces/${created.id}`);
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className={props?.buttonClassName ? `gap-2 ${props.buttonClassName}` : 'gap-2'}>
          <Plus className="h-4 w-4" />
          {props?.buttonLabel ?? 'Create Workspace'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted">
          Create the workspace here, then continue setup from the workspace detail page.
        </p>
        <WorkspaceEditorForm
          form={form}
          error={mutation.error ? formatWorkspaceDialogError(mutation.error) : null}
          submitLabel="Create workspace"
          isPending={mutation.isPending}
          onCancel={() => setIsOpen(false)}
          onNameChange={(value) => {
            const slug = value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '');
            setForm((previous) => ({ ...previous, name: value, slug }));
          }}
          onFieldChange={(field, value) => {
            setForm((previous) => ({ ...previous, [field]: value }));
          }}
          onSubmit={() => mutation.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWorkspaceDialog(props: {
  workspace: DashboardWorkspaceRecord;
  onClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteImpactQuery = useQuery({
    queryKey: ['workspace-delete-impact', props.workspace.id],
    queryFn: () => dashboardApi.getWorkspaceDeleteImpact(props.workspace.id),
  });
  const deleteImpact = deleteImpactQuery.data ?? null;
  const shouldCascade = hasWorkspaceDeleteImpact(deleteImpact);
  const mutation = useMutation({
    mutationFn: () => dashboardApi.deleteWorkspace(props.workspace.id, { cascade: shouldCascade }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      props.onClose();
      navigate('/design/workspaces');
      toast.success('Workspace deleted');
    },
    onError: (error) => {
      toast.error(formatWorkspaceDeleteError(error));
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete Workspace</DialogTitle>
          <DialogDescription>
            Delete permanently removes this workspace. Linked workflows, tasks, and work items are
            deleted at the same time.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">
            Are you sure you want to delete &quot;{props.workspace.name}&quot;? This action cannot
            be undone.
          </p>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <div className="text-sm font-medium text-foreground">Delete impact</div>
            {deleteImpactQuery.isLoading ? (
              <p className="mt-2 text-sm text-muted">Loading delete impact…</p>
            ) : deleteImpactQuery.error ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Failed to load delete impact: {formatWorkspaceDeleteError(deleteImpactQuery.error)}
              </p>
            ) : deleteImpact ? (
              <WorkspaceDeleteImpactSummary impact={deleteImpact} />
            ) : null}
          </div>
          <p className="text-sm leading-6 text-muted">
            {shouldCascade
              ? 'This will stop active workflows before deleting the workspace and every linked workflow, task, and work item.'
              : 'This workspace has no linked work and can be deleted immediately.'}
          </p>
        </div>
        {mutation.error ? (
          <p className="text-sm text-red-600">{formatWorkspaceDeleteError(mutation.error)}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || deleteImpactQuery.isLoading || Boolean(deleteImpactQuery.error)}
            data-testid="confirm-delete"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {shouldCascade ? 'Delete workspace and linked work' : 'Delete workspace'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceDeleteImpactSummary(props: {
  impact: DashboardDeleteImpactSummary;
}): JSX.Element {
  const items = [
    ['Workflows', props.impact.workflows],
    ['Active workflows', props.impact.active_workflows],
    ['Tasks', props.impact.tasks],
    ['Active tasks', props.impact.active_tasks],
    ['Work items', props.impact.work_items],
  ] as const;

  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border/70 bg-background/80 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</dt>
          <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function hasWorkspaceDeleteImpact(impact: DashboardDeleteImpactSummary | null): boolean {
  if (!impact) {
    return false;
  }
  return (
    impact.workflows > 0
    || impact.active_workflows > 0
    || impact.tasks > 0
    || impact.active_tasks > 0
    || impact.work_items > 0
  );
}

function WorkspaceEditorForm(props: {
  form: WorkspaceFormData;
  error: string | null;
  submitLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onFieldChange: (field: keyof WorkspaceFormData, value: string) => void;
  onSubmit: () => void;
}): JSX.Element {
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const validation = validateWorkspaceForm(props.form);
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: props.error,
    showValidation: hasAttemptedSubmit,
    isValid: validation.isValid,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!validation.isValid) {
          setHasAttemptedSubmit(true);
          return;
        }
        props.onSubmit();
      }}
      noValidate
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input
            placeholder="My Workspace"
            value={props.form.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            aria-invalid={Boolean(hasAttemptedSubmit && validation.fieldErrors.name)}
          />
          <FieldErrorText
            message={hasAttemptedSubmit ? validation.fieldErrors.name : undefined}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Slug</label>
          <Input
            placeholder="my-workspace"
            value={props.form.slug}
            onChange={(event) => props.onFieldChange('slug', event.target.value)}
            aria-invalid={Boolean(hasAttemptedSubmit && validation.fieldErrors.slug)}
          />
          <FieldErrorText
            message={hasAttemptedSubmit ? validation.fieldErrors.slug : undefined}
          />
        </div>
      </div>
      <FormFeedbackMessage message={formFeedbackMessage} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={props.isPending}>
          {props.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

function validateWorkspaceForm(form: WorkspaceFormData): {
  fieldErrors: {
    name?: string;
    slug?: string;
  };
  isValid: boolean;
} {
  const fieldErrors: {
    name?: string;
    slug?: string;
  } = {};

  if (!form.name.trim()) {
    fieldErrors.name = 'Enter a workspace name.';
  }

  if (!form.slug.trim()) {
    fieldErrors.slug = 'Enter a workspace slug.';
  }

  return {
    fieldErrors,
    isValid: Object.keys(fieldErrors).length === 0,
  };
}
