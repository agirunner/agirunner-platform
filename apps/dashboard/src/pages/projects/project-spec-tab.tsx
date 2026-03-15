import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectRecord, DashboardProjectSpecRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import {
  buildStructuredObject,
  createStructuredEntryDraft,
  objectToStructuredDrafts,
  type StructuredEntryDraft,
} from './project-detail-support.js';
import { ErrorCard, LoadingCard } from './project-detail-shared.js';
import { StructuredEntryEditor } from './project-structured-entry-editor.js';
import { summarizeProjectContext } from './project-settings-support.js';

const EMPTY_SPEC_SECTION = {};

export function ProjectSpecTab({ projectId }: { projectId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<StructuredEntryDraft[]>([]);
  const [projectContext, setProjectContext] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => dashboardApi.getProject(projectId),
  });
  const specQuery = useQuery({
    queryKey: ['project-spec', projectId],
    queryFn: () => dashboardApi.getProjectSpec(projectId),
  });

  useEffect(() => {
    if (!specQuery.data) {
      return;
    }
    setKnowledgeDrafts(toKnowledgeDrafts(specQuery.data));
  }, [specQuery.data]);

  useEffect(() => {
    if (!projectQuery.data) {
      return;
    }
    setProjectContext(readProjectContext(projectQuery.data));
  }, [projectQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextSpec = buildProjectSpecPayload(specQuery.data, knowledgeDrafts);
      const nextSettings = buildProjectSettingsPatch(projectQuery.data, projectContext);
      await Promise.all([
        dashboardApi.updateProjectSpec(projectId, nextSpec),
        dashboardApi.patchProject(projectId, { settings: nextSettings }),
      ]);
    },
    onSuccess: async () => {
      setSaveMessage('Knowledge saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-spec', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
  });

  if (projectQuery.isLoading || specQuery.isLoading) {
    return <LoadingCard />;
  }
  if (projectQuery.error || specQuery.error) {
    return <ErrorCard message="Failed to load project knowledge." />;
  }

  const spec = specQuery.data as DashboardProjectSpecRecord;
  const contextSummary = summarizeProjectContext(projectContext);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {saveMessage ? <p className="text-sm text-muted">{saveMessage}</p> : <div />}
        <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          <Save className="h-4 w-4" />
          Save Knowledge
        </Button>
      </div>

      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Project Context</CardTitle>
          <p className="text-sm leading-6 text-muted">
            Reusable project context for playbooks. This is the place for durable LLM context that
            should flow into workflow inputs.
          </p>
          <p className="max-w-3xl text-sm leading-5 text-muted">
            {contextSummary}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={projectContext}
            className="min-h-[160px]"
            onChange={(event) => {
              setSaveMessage(null);
              setProjectContext(event.target.value);
            }}
          />
          <p className="text-sm leading-6 text-muted">
            Use this for stable project context. It is separate from the project description and can
            be mapped by playbooks into workflow inputs.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-none">
        <CardHeader className="space-y-2">
          <CardTitle className="text-base">Project knowledge</CardTitle>
          <p className="text-sm leading-6 text-muted">
            Edit curated project facts and policies as simple key/value entries instead of managing
            separate config, instruction, resource, and document sections.
          </p>
          <p className="max-w-3xl text-sm leading-5 text-muted">
            {buildKnowledgeSummary(knowledgeDrafts.length)}
          </p>
        </CardHeader>
        <CardContent>
          <StructuredEntryEditor
            title="Project knowledge"
            description="Only string and JSON values are supported here."
            drafts={knowledgeDrafts}
            onChange={(drafts) => {
              setSaveMessage(null);
              setKnowledgeDrafts(normalizeKnowledgeDrafts(drafts));
            }}
            addLabel="Add knowledge entry"
            allowedTypes={['string', 'json']}
            stringInputMode="multiline"
          />
        </CardContent>
      </Card>

      {saveMutation.error ? (
        <p className="rounded-xl border border-red-300/70 bg-background/70 px-3 py-2 text-sm text-red-700 dark:border-red-800/70 dark:text-red-300">
          {saveMutation.error instanceof Error
            ? saveMutation.error.message
            : 'Failed to save project knowledge.'}
        </p>
      ) : null}
    </div>
  );
}

function readProjectContext(project: DashboardProjectRecord): string {
  const settings = asRecord(project.settings);
  return typeof settings.project_brief === 'string' ? settings.project_brief : '';
}

function buildProjectSettingsPatch(
  project: DashboardProjectRecord | undefined,
  projectContext: string,
): Record<string, unknown> {
  const existing = asRecord(project?.settings);
  return {
    ...existing,
    project_brief: projectContext.trim(),
  };
}

function buildProjectSpecPayload(
  spec: DashboardProjectSpecRecord | undefined,
  knowledgeDrafts: StructuredEntryDraft[],
): Record<string, unknown> {
  const nextConfig = buildStructuredObject(
    normalizeKnowledgeDrafts(knowledgeDrafts),
    'Project knowledge',
  ) ?? {};

  return {
    config: nextConfig,
    instructions: EMPTY_SPEC_SECTION,
    resources: EMPTY_SPEC_SECTION,
    documents: EMPTY_SPEC_SECTION,
    ...(hasRecord(spec?.tools) ? { tools: spec?.tools } : {}),
  };
}

function toKnowledgeDrafts(spec: DashboardProjectSpecRecord): StructuredEntryDraft[] {
  return normalizeKnowledgeDrafts(objectToStructuredDrafts(spec.config));
}

function normalizeKnowledgeDrafts(drafts: StructuredEntryDraft[]): StructuredEntryDraft[] {
  return drafts.map((draft) => ({
    ...draft,
    valueType: draft.valueType === 'json' ? 'json' : 'string',
  }));
}

function buildKnowledgeSummary(entryCount: number): string {
  if (entryCount === 0) {
    return 'No curated knowledge entries saved yet.';
  }
  return `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} ready for runtime and workflow access.`;
}

function hasRecord(value: unknown): boolean {
  return Object.keys(asRecord(value)).length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
