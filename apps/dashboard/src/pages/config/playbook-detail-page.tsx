import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
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

const DEFAULT_LIFECYCLE = 'continuous';

export function PlaybookDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const playbookId = params.id ?? '';
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState('');
  const [lifecycle, setLifecycle] = useState<'standard' | 'continuous'>(DEFAULT_LIFECYCLE);
  const [draft, setDraft] = useState<PlaybookAuthoringDraft>(
    () => hydratePlaybookAuthoringDraft(DEFAULT_LIFECYCLE, {}),
  );
  const [definitionError, setDefinitionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedPlaybookId, setLoadedPlaybookId] = useState<string | null>(null);

  const playbookQuery = useQuery({
    queryKey: ['playbook', playbookId],
    queryFn: () => dashboardApi.getPlaybook(playbookId),
    enabled: playbookId.length > 0,
  });

  useEffect(() => {
    const playbook = playbookQuery.data;
    if (!playbook || loadedPlaybookId === playbook.id) {
      return;
    }
    const nextLifecycle = playbook.lifecycle ?? DEFAULT_LIFECYCLE;
    setName(playbook.name);
    setSlug(playbook.slug);
    setDescription(playbook.description ?? '');
    setOutcome(playbook.outcome);
    setLifecycle(nextLifecycle);
    setDraft(hydratePlaybookAuthoringDraft(nextLifecycle, playbook.definition));
    setDefinitionError(null);
    setMessage(null);
    setLoadedPlaybookId(playbook.id);
  }, [loadedPlaybookId, playbookQuery.data]);

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
      setLoadedPlaybookId(playbook.id);
      setDefinitionError(null);
      setMessage('Playbook saved.');
    },
    onError: (error) => {
      setMessage(null);
      setDefinitionError(error instanceof Error ? error.message : 'Failed to save playbook.');
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
            <Link to={`/config/playbooks/${playbook.id}/launch`}>Launch</Link>
          </Button>
          <Button disabled={!canSave || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
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
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-[96px]" />
          </label>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Lifecycle</span>
            <Select value={lifecycle} onValueChange={(value) => setLifecycle(value as 'standard' | 'continuous')}>
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
