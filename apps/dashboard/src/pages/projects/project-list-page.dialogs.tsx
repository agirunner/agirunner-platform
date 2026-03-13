import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';

import { dashboardApi, type DashboardProjectRecord } from '../../lib/api.js';
import { readSession } from '../../lib/session.js';
import { toast } from '../../lib/toast.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';

const API_BASE_URL = import.meta.env.VITE_PLATFORM_API_URL ?? 'http://localhost:8080';

interface ProjectFormData {
  name: string;
  slug: string;
  description: string;
  repository_url: string;
}

const INITIAL_FORM: ProjectFormData = {
  name: '',
  slug: '',
  description: '',
  repository_url: '',
};

function getAuthHeaders(): Record<string, string> {
  const session = readSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return headers;
}

async function deleteProject(id: string): Promise<void> {
  const session = readSession();
  const headers: Record<string, string> = {};
  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/projects/${id}`, {
    method: 'DELETE',
    headers,
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function updateProject(
  id: string,
  payload: Record<string, unknown>,
): Promise<DashboardProjectRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/projects/${id}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return body.data ?? body;
}

export function CreateProjectDialog(): JSX.Element {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<ProjectFormData>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () =>
      dashboardApi.createProject({
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        repository_url: form.repository_url || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Create Project
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <ProjectEditorForm
          form={form}
          error={mutation.error ? String(mutation.error) : null}
          submitLabel="Create project"
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

export function DeleteProjectDialog(props: {
  project: DashboardProjectRecord;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteProject(props.project.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      props.onClose();
      toast.success('Project deleted');
    },
    onError: () => {
      toast.error('Failed to delete project');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delete Project</DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted">
          Are you sure you want to delete &quot;{props.project.name}&quot;? This action cannot be
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
            Delete project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditProjectDialog(props: {
  project: DashboardProjectRecord;
  onClose: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProjectFormData>({
    name: props.project.name,
    slug: props.project.slug,
    description: props.project.description ?? '',
    repository_url: props.project.repository_url ?? '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      updateProject(props.project.id, {
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        repository_url: form.repository_url || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      props.onClose();
      toast.success('Project updated');
    },
    onError: () => {
      toast.error('Failed to update project');
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>
        <ProjectEditorForm
          form={form}
          error={mutation.error ? String(mutation.error) : null}
          submitLabel="Save project"
          isPending={mutation.isPending}
          onCancel={props.onClose}
          onNameChange={(value) => setForm((previous) => ({ ...previous, name: value }))}
          onFieldChange={(field, value) => {
            setForm((previous) => ({ ...previous, [field]: value }));
          }}
          onSubmit={() => mutation.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectEditorForm(props: {
  form: ProjectFormData;
  error: string | null;
  submitLabel: string;
  isPending: boolean;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onFieldChange: (field: keyof ProjectFormData, value: string) => void;
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
            placeholder="My Project"
            value={props.form.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Slug</label>
          <Input
            placeholder="my-project"
            value={props.form.slug}
            onChange={(event) => props.onFieldChange('slug', event.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Description</label>
        <Textarea
          placeholder="What operators should know about this workspace..."
          value={props.form.description}
          onChange={(event) => props.onFieldChange('description', event.target.value)}
          rows={4}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Repository URL</label>
        <Input
          placeholder="https://github.com/org/repo"
          value={props.form.repository_url}
          onChange={(event) => props.onFieldChange('repository_url', event.target.value)}
        />
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
