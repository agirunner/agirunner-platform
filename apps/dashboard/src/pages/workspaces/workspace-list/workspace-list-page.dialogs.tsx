import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { dashboardApi, type DashboardWorkspaceRecord } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';
import { Button } from '../../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
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
  const message = String(error ?? '').trim();
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
      navigate(`/workspaces/${created.id}`);
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
  const mutation = useMutation({
    mutationFn: () => dashboardApi.deleteWorkspace(props.workspace.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      props.onClose();
      navigate('/workspaces');
      toast.success('Workspace deleted');
    },
    onError: () => {
      toast.error('Failed to delete workspace');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete Workspace</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted">
          Are you sure you want to delete &quot;{props.workspace.name}&quot;? This action cannot be
          undone.
        </p>
        {mutation.error ? (
          <p className="text-sm text-red-600">{String(mutation.error)}</p>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="confirm-delete"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Delete workspace
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium">Name</label>
          <Input
            placeholder="My Workspace"
            value={props.form.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Slug</label>
          <Input
            placeholder="my-workspace"
            value={props.form.slug}
            onChange={(event) => props.onFieldChange('slug', event.target.value)}
            required
          />
        </div>
      </div>
      {props.error ? <p className="text-sm text-red-600">{props.error}</p> : null}
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
