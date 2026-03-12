import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Rocket, Search, Settings2 } from 'lucide-react';

import { dashboardApi, type DashboardPlaybookRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import {
  buildPlaybookDefinition,
  createDefaultAuthoringDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import { PlaybookAuthoringForm } from './playbook-authoring-form.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';

const DEFAULT_LIFECYCLE = 'continuous';

export function PlaybookListPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [lifecycle, setLifecycle] = useState<'standard' | 'continuous'>(DEFAULT_LIFECYCLE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() => createDefaultAuthoringDraft(DEFAULT_LIFECYCLE));
  const [definitionError, setDefinitionError] = useState<string | null>(null);

  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const definition = buildPlaybookDefinition(lifecycle, draft);
      if (!definition.ok) {
        throw new Error(definition.error);
      }
      return dashboardApi.createPlaybook({
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        outcome: outcome.trim(),
        lifecycle,
        definition: definition.value,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      resetForm();
      setDialogOpen(false);
    },
    onError: (error) => {
      setDefinitionError(error instanceof Error ? error.message : 'Failed to create playbook');
    },
  });

  const filtered = useMemo(() => {
    const all = playbooksQuery.data?.data ?? [];
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return all;
    }
    return all.filter((playbook) =>
      [playbook.name, playbook.slug, playbook.description ?? '', playbook.outcome]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [playbooksQuery.data?.data, search]);

  function resetForm() {
    setName('');
    setSlug('');
    setDescription('');
    setOutcome('');
    setLifecycle(DEFAULT_LIFECYCLE);
    setDraft(createDefaultAuthoringDraft(DEFAULT_LIFECYCLE));
    setDefinitionError(null);
  }

  function handleLifecycleChange(next: 'standard' | 'continuous') {
    setLifecycle(next);
    setDraft(createDefaultAuthoringDraft(next));
    setDefinitionError(null);
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks</h1>
          <p className="text-sm text-muted">
            Define reusable orchestrated workflow operating models and launch runs from them.
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New Playbook
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search playbooks..."
          className="pl-9"
        />
      </div>

      {playbooksQuery.isLoading ? <p className="text-sm text-muted">Loading playbooks...</p> : null}
      {playbooksQuery.error ? <p className="text-sm text-red-600">Failed to load playbooks.</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((playbook) => (
          <PlaybookCard key={playbook.id} playbook={playbook} />
        ))}
        {!playbooksQuery.isLoading && filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted">
              No playbooks match the current search.
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Playbook</DialogTitle>
            <DialogDescription>
              Define roles, board flow, stages, runtime pools, and workflow parameters in structured sections.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Name</span>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Slug</span>
                <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="optional" />
              </label>
            </div>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Outcome</span>
              <Input value={outcome} onChange={(event) => setOutcome(event.target.value)} />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Description</span>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-[80px]"
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Lifecycle</span>
              <Select value={lifecycle} onValueChange={(value) => handleLifecycleChange(value as 'standard' | 'continuous')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="continuous">Continuous</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <PlaybookAuthoringForm
              draft={draft}
              onChange={setDraft}
              onClearError={() => setDefinitionError(null)}
            />

            {definitionError ? <p className="text-sm text-red-600">{definitionError}</p> : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name.trim() || !outcome.trim()}
              >
                Create Playbook
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

}

function PlaybookCard({ playbook }: { playbook: DashboardPlaybookRecord }) {
  const boardColumns = Array.isArray((playbook.definition as { board?: { columns?: unknown[] } }).board?.columns)
    ? ((playbook.definition as { board?: { columns?: unknown[] } }).board?.columns?.length ?? 0)
    : 0;
  const stages = Array.isArray((playbook.definition as { stages?: unknown[] }).stages)
    ? ((playbook.definition as { stages?: unknown[] }).stages?.length ?? 0)
    : 0;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{playbook.name}</CardTitle>
            <p className="text-sm text-muted">{playbook.slug}</p>
          </div>
          <Badge variant="outline">v{playbook.version}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{playbook.lifecycle}</Badge>
          <Badge variant="outline">{boardColumns} columns</Badge>
          <Badge variant="outline">{stages} stages</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {playbook.description ? <p className="text-sm text-muted">{playbook.description}</p> : null}
        <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <div className="font-medium">Outcome</div>
          <div className="text-muted">{playbook.outcome}</div>
        </div>
        <div className="flex justify-end">
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to={`/config/playbooks/${playbook.id}`}>
                <Settings2 className="h-4 w-4" />
                Manage
              </Link>
            </Button>
            <Button asChild>
            <Link to={`/config/playbooks/${playbook.id}/launch`}>
              <Rocket className="h-4 w-4" />
              Launch
            </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
