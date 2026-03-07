import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderOpen, GitBranch, Loader2 } from 'lucide-react';
import { dashboardApi, type DashboardProjectRecord } from '../../lib/api.js';
import { cn } from '../../lib/utils.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';

interface CreateProjectFormData {
  name: string;
  slug: string;
  description: string;
  repository_url: string;
}

const INITIAL_FORM: CreateProjectFormData = {
  name: '',
  slug: '',
  description: '',
  repository_url: '',
};

function normalizeProjects(
  response: { data: DashboardProjectRecord[] } | DashboardProjectRecord[],
): DashboardProjectRecord[] {
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

function statusVariant(isActive?: boolean) {
  if (isActive === true) return 'success' as const;
  if (isActive === false) return 'secondary' as const;
  return 'outline' as const;
}

function CreateProjectDialog() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<CreateProjectFormData>(INITIAL_FORM);

  const mutation = useMutation({
    mutationFn: () =>
      dashboardApi.createProject({
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        repository_url: form.repository_url || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setForm(INITIAL_FORM);
      setIsOpen(false);
    },
  });

  function handleFieldChange(field: keyof CreateProjectFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleNameChange(value: string) {
    const slug = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setForm((prev) => ({ ...prev, name: value, slug }));
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Create Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Project</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input
              placeholder="My Project"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Slug</label>
            <Input
              placeholder="my-project"
              value={form.slug}
              onChange={(e) => handleFieldChange('slug', e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              placeholder="Project description..."
              value={form.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Repository URL</label>
            <Input
              placeholder="https://github.com/org/repo"
              value={form.repository_url}
              onChange={(e) => handleFieldChange('repository_url', e.target.value)}
            />
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">
              {String(mutation.error)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectCard({ project }: { project: DashboardProjectRecord }) {
  return (
    // Click card -> navigates to /projects/:id (project detail page)
    <Card
      className={cn(
        'cursor-pointer transition-shadow hover:shadow-md',
      )}
      onClick={() => {
        window.location.assign(`/projects/${project.id}`);
      }}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{project.name}</CardTitle>
          <Badge variant={statusVariant(project.is_active)}>
            {project.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {project.description ? (
          <p className="text-sm text-muted line-clamp-2">{project.description}</p>
        ) : (
          <p className="text-sm text-muted italic">No description</p>
        )}
      </CardContent>
      <CardFooter className="flex items-center gap-4 text-xs text-muted">
        {project.repository_url && (
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            Linked
          </span>
        )}
        {project.created_at && (
          <span>{new Date(project.created_at).toLocaleDateString()}</span>
        )}
      </CardFooter>
    </Card>
  );
}

export function ProjectListPage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });

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
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load projects: {String(error)}
        </div>
      </div>
    );
  }

  const projects = normalizeProjects(data ?? []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted">
            Manage your project workspaces and configurations.
          </p>
        </div>
        <CreateProjectDialog />
      </div>

      {projects.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-12">
          <FolderOpen className="h-12 w-12 text-muted mb-4" />
          <p className="text-muted font-medium">No projects yet</p>
          <p className="text-sm text-muted mt-1">
            Create your first project to get started.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
