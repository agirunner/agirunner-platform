import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, RotateCcw, Save, Trash2 } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  buildPlaybookDefinition,
  hydratePlaybookAuthoringDraft,
  type PlaybookAuthoringDraft,
} from './playbook-authoring-support.js';
import { PlaybookAuthoringForm } from './playbook-authoring-form.js';
import {
  buildPlaybookRestorePayload,
  buildPlaybookRevisionChain,
  buildPlaybookRevisionDiff,
} from './playbook-detail-support.js';
import {
  PlaybookControlCenterCard,
  PlaybookRevisionHistoryCard,
} from './playbook-detail-sections.js';

const DEFAULT_LIFECYCLE = 'continuous';

export function PlaybookDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const playbookId = params.id ?? '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [lifecycle, setLifecycle] = useState<'standard' | 'continuous'>(DEFAULT_LIFECYCLE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(() =>
    hydratePlaybookAuthoringDraft(DEFAULT_LIFECYCLE, {}),
  );
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedPlaybookId, setLoadedPlaybookId] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const playbookQuery = useQuery({
    queryKey: ['playbook', playbookId],
    queryFn: () => dashboardApi.getPlaybook(playbookId),
    enabled: playbookId.length > 0,
  });
  const playbooksQuery = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => dashboardApi.listPlaybooks(),
  });
  const roleDefinitionsQuery = useQuery({
    queryKey: ['role-definitions', 'active'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
  });
  const llmProvidersQuery = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => dashboardApi.listLlmProviders(),
  });
  const llmModelsQuery = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => dashboardApi.listLlmModels(),
  });
  const [comparedRevisionId, setComparedRevisionId] = useState('');

  function loadPlaybook(playbook: NonNullable<typeof playbookQuery.data>): void {
    const nextLifecycle = playbook.lifecycle ?? DEFAULT_LIFECYCLE;
    setName(playbook.name);
    setSlug(playbook.slug);
    setDescription(playbook.description ?? '');
    setOutcome(playbook.outcome);
    setLifecycle(nextLifecycle);
    setDraft(hydratePlaybookAuthoringDraft(nextLifecycle, playbook.definition));
    setLoadedPlaybookId(playbook.id);
  }

  useEffect(() => {
    const playbook = playbookQuery.data;
    if (!playbook || loadedPlaybookId === playbook.id) {
      return;
    }
    loadPlaybook(playbook);
    setDefinitionError(null);
    setMessage(null);
  }, [loadedPlaybookId, playbookQuery.data]);

  const revisions = useMemo(() => {
    const playbook = playbookQuery.data;
    const allPlaybooks = playbooksQuery.data?.data ?? [];
    if (!playbook) {
      return [];
    }
    return buildPlaybookRevisionChain(allPlaybooks, playbook);
  }, [playbookQuery.data, playbooksQuery.data?.data]);

  useEffect(() => {
    if (revisions.length === 0) {
      return;
    }
    const fallbackRevisionId =
      revisions.find((revision) => revision.id !== playbookId)?.id ?? revisions[0]?.id ?? '';
    setComparedRevisionId((current) =>
      current && revisions.some((revision) => revision.id === current)
        ? current
        : fallbackRevisionId,
    );
  }, [playbookId, revisions]);

  const comparedRevision = useMemo(
    () => revisions.find((revision) => revision.id === comparedRevisionId) ?? null,
    [comparedRevisionId, revisions],
  );

  const revisionDiff = useMemo(() => {
    const playbook = playbookQuery.data;
    if (!playbook || !comparedRevision) {
      return [];
    }
    return buildPlaybookRevisionDiff(playbook, comparedRevision);
  }, [comparedRevision, playbookQuery.data]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const definition = buildPlaybookDefinition(lifecycle, draft);
      if (definition.ok === false) {
        throw new Error(definition.error);
      }
      return dashboardApi.updatePlaybook(playbookId, {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || undefined,
        outcome: outcome.trim(),
        lifecycle,
        definition: definition.value,
      });
    },
    onSuccess: (playbook) => {
      loadPlaybook(playbook);
      setDefinitionError(null);
      setMessage(`Playbook saved as v${playbook.version}.`);
      void playbooksQuery.refetch();
      void navigate(`/config/playbooks/${playbook.id}`, { replace: true });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to save playbook.');
    },
  });
  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!comparedRevision) {
        throw new Error('Choose a revision to restore.');
      }
      if (comparedRevision.id === playbookId) {
        throw new Error('Select an older version before restoring.');
      }
      return dashboardApi.updatePlaybook(playbookId, buildPlaybookRestorePayload(comparedRevision));
    },
    onSuccess: (playbook) => {
      loadPlaybook(playbook);
      setDefinitionError(null);
      setMessage(`Restored v${playbook.version} from an earlier revision.`);
      void playbooksQuery.refetch();
      void navigate(`/config/playbooks/${playbook.id}`, { replace: true });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(
        error instanceof Error ? error.message : 'Failed to restore playbook revision.',
      );
    },
  });
  const archiveStateMutation = useMutation({
    mutationFn: (archived: boolean) =>
      archived
        ? dashboardApi.archivePlaybook(playbookId)
        : dashboardApi.restorePlaybook(playbookId),
    onSuccess: async (nextPlaybook) => {
      loadPlaybook(nextPlaybook);
      setArchiveOpen(false);
      setDeleteOpen(false);
      setDefinitionError(null);
      setMessage(
        nextPlaybook.is_active
          ? `Playbook restored as the active revision for ${nextPlaybook.slug}.`
          : 'Playbook archived. Launch is disabled until this revision is restored or superseded.',
      );
      await queryClient.invalidateQueries({ queryKey: ['playbook', playbookId] });
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(
        error instanceof Error ? error.message : 'Failed to change playbook archive state.',
      );
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => dashboardApi.deletePlaybook(playbookId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbooks'] });
      await navigate('/config/playbooks');
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to delete playbook.');
    },
  });

  const canSave = useMemo(
    () => Boolean(playbookId && name.trim() && outcome.trim()),
    [name, outcome, playbookId],
  );

  if (playbookQuery.isLoading) {
    return <div className="p-6 text-sm text-muted">Loading playbook...</div>;
  }

  if (playbookQuery.error || !playbookQuery.data) {
    return <div className="p-6 text-sm text-red-600">Failed to load playbook.</div>;
  }

  const playbook = playbookQuery.data;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{playbook.name}</h1>
            <Badge variant="outline">v{playbook.version}</Badge>
            <Badge variant="secondary">{playbook.lifecycle}</Badge>
            {!playbook.is_active ? <Badge variant="destructive">Archived</Badge> : null}
          </div>
          <p className="text-sm text-muted">
            Edit playbook structure, runtime posture, and launch-time parameter definitions without
            dropping to raw JSON.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/config/roles">Manage Roles</Link>
          </Button>
          {playbook.is_active ? (
            <Button asChild variant="outline">
              <Link to={`/config/playbooks/${playbook.id}/launch`}>Launch</Link>
            </Button>
          ) : null}
          {playbook.is_active ? (
            <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => archiveStateMutation.mutate(false)}
              disabled={archiveStateMutation.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </Button>
          )}
          <Button
            disabled={!canSave || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            Save Playbook
          </Button>
          <Button variant="outline" onClick={() => setDeleteOpen(true)} disabled={deleteMutation.isPending}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Playbook Details</CardTitle>
          <p className="text-sm text-muted">
            Keep the playbook identity and operating model visible while you edit the structured
            authoring sections below.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Name</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Slug</span>
            <Input value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-medium">Outcome</span>
            <Input value={outcome} onChange={(event) => setOutcome(event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm md:col-span-2">
            <span className="font-medium">Description</span>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-[96px]"
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Lifecycle</span>
            <Select
              value={lifecycle}
              onValueChange={(value) => setLifecycle(value as 'standard' | 'continuous')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="continuous">Continuous</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-2 text-sm">
            <span className="font-medium">Metadata</span>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted">
              Created {formatDate(playbook.created_at)}. Updated {formatDate(playbook.updated_at)}.
            </div>
          </div>
          <div className="grid gap-2 text-sm md:col-span-2">
            <span className="font-medium">Configuration model</span>
            <div className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted">
              Configure playbook-specific orchestrator instructions, tool grants, cadence, and
              runtime pools below. Reusable prompts, model preferences, and escalation policy for
              specialist or orchestrator roles live on the Role Definitions page.
            </div>
          </div>
          {!playbook.is_active ? (
            <div className="grid gap-2 text-sm md:col-span-2">
              <span className="font-medium">Archive state</span>
              <div className="rounded-md border border-amber-300 bg-amber-50/80 p-3 text-sm text-amber-950">
                This playbook is archived. Revision history remains available, but launch is
                disabled until a new active revision is created.
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <PlaybookAuthoringForm
        draft={draft}
        onChange={setDraft}
        onClearError={() => {
          setDefinitionError(null);
          setMessage(null);
        }}
      />

      {definitionError ? <p className="text-sm text-red-600">{definitionError}</p> : null}
      {message ? <p className="text-sm text-green-600">{message}</p> : null}

      <PlaybookControlCenterCard
        playbook={playbook}
        activeRoleCount={(roleDefinitionsQuery.data ?? []).filter((role) => role.is_active).length}
        llmProviders={llmProvidersQuery.data ?? []}
        llmModels={llmModelsQuery.data ?? []}
      />

      <PlaybookRevisionHistoryCard
        currentPlaybook={playbook}
        revisions={revisions.length > 0 ? revisions : [playbook]}
        comparedRevisionId={comparedRevisionId || playbook.id}
        diffRows={revisionDiff}
        onComparedRevisionChange={setComparedRevisionId}
        onRestore={() => restoreMutation.mutate()}
        isRestoring={restoreMutation.isPending}
      />

      <div className="sticky bottom-4 z-10">
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-surface/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-medium">Save changes from anywhere in the editor</div>
            <p className="text-sm text-muted">
              The action bar stays visible while you review the control center, revisions, and
              longer authoring sections.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/config/roles">Manage Roles</Link>
            </Button>
            {playbook.is_active ? (
              <Button asChild variant="outline">
                <Link to={`/config/playbooks/${playbook.id}/launch`}>Launch</Link>
              </Button>
            ) : null}
            {playbook.is_active ? (
              <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
                <Archive className="h-4 w-4" />
                Archive
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => archiveStateMutation.mutate(false)}
                disabled={archiveStateMutation.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Restore
              </Button>
            )}
            <Button
              disabled={!canSave || updateMutation.isPending}
              onClick={() => updateMutation.mutate()}
            >
              <Save className="h-4 w-4" />
              Save Playbook
            </Button>
            <Button variant="outline" onClick={() => setDeleteOpen(true)} disabled={deleteMutation.isPending}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Archive Playbook</DialogTitle>
            <DialogDescription>
              Archive disables launch for this playbook family while keeping every revision
              available for audit and restore flows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Archiving <span className="font-medium text-foreground">{playbook.name}</span> marks
              the active revisions on slug <span className="font-mono">{playbook.slug}</span> as
              archived. Existing workflow history is preserved.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setArchiveOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => archiveStateMutation.mutate(true)}
                disabled={archiveStateMutation.isPending}
              >
                Archive Playbook
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-h-[70vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delete Playbook Revision</DialogTitle>
            <DialogDescription>
              Delete permanently removes this revision from the playbook library.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted">
            <p>
              Deleting <span className="font-medium text-foreground">{playbook.name}</span>{' '}
              version <span className="font-mono">v{playbook.version}</span> does not remove
              sibling revisions, but any workflows that already reference this revision will block
              deletion.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Keep revision
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                Delete Revision
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown time';
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
