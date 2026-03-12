import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
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
      if (!definition.ok) {
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
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{playbook.name}</h1>
            <Badge variant="outline">v{playbook.version}</Badge>
            <Badge variant="secondary">{playbook.lifecycle}</Badge>
          </div>
          <p className="text-sm text-muted">
            Edit playbook structure, runtime posture, and launch-time parameter definitions without
            dropping to raw JSON.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/config/roles">Manage Roles</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/config/playbooks/${playbook.id}/launch`}>Launch</Link>
          </Button>
          <Button
            disabled={!canSave || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            Save Playbook
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Playbook Details</CardTitle>
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
