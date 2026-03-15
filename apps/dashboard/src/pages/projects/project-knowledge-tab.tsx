import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardProjectRecord, DashboardProjectSpecRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import {
  buildStructuredObject,
  objectToStructuredDrafts,
  type ProjectWorkspaceOverview,
  type StructuredEntryDraft,
} from './project-detail-support.js';
import { ErrorCard, LoadingCard } from './project-detail-shared.js';
import { ContentBrowserSurface } from './content-browser-page.js';
import { ProjectDetailMemoryTab } from './project-detail-memory-tab.js';
import { ProjectKnowledgeShell } from './project-knowledge-shell.js';
import { ProjectSpecTab } from './project-spec-tab.js';

const EMPTY_SPEC_SECTION = {};

export function ProjectKnowledgeTab(props: {
  projectId: string;
  overview: ProjectWorkspaceOverview;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<StructuredEntryDraft[]>([]);
  const [projectContext, setProjectContext] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', props.projectId],
    queryFn: () => dashboardApi.getProject(props.projectId),
  });
  const specQuery = useQuery({
    queryKey: ['project-spec', props.projectId],
    queryFn: () => dashboardApi.getProjectSpec(props.projectId),
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
      const nextKnowledge = buildProjectKnowledgeRecord(knowledgeDrafts);
      const nextSpec = buildProjectSpecPayload(specQuery.data, nextKnowledge);
      const nextSettings = buildProjectSettingsPatch(projectQuery.data, projectContext, nextKnowledge);

      await Promise.all([
        dashboardApi.updateProjectSpec(props.projectId, nextSpec),
        dashboardApi.patchProject(props.projectId, { settings: nextSettings }),
      ]);
    },
    onSuccess: async () => {
      setSaveMessage('Knowledge saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-spec', props.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', props.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
  });

  const validationError = readKnowledgeValidationError(knowledgeDrafts);
  const saveErrorMessage = validationError ?? readMutationError(saveMutation.error);

  if (projectQuery.isLoading || specQuery.isLoading) {
    return <LoadingCard />;
  }

  if (projectQuery.error || specQuery.error) {
    return <ErrorCard message="Failed to load project knowledge." />;
  }

  return (
    <div className="space-y-3">
      <ProjectKnowledgeShell
        projectId={props.projectId}
        overview={props.overview}
        headerNotice={saveMessage ? <p className="text-sm text-muted">{saveMessage}</p> : null}
        headerAction={
          <Button
            size="sm"
            disabled={saveMutation.isPending || Boolean(validationError)}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-4 w-4" />
            Save knowledge
          </Button>
        }
        referenceContent={
          <ProjectSpecTab
            projectContext={projectContext}
            knowledgeDrafts={knowledgeDrafts}
            saveErrorMessage={saveErrorMessage}
            onProjectContextChange={(value) => {
              setSaveMessage(null);
              saveMutation.reset();
              setProjectContext(value);
            }}
            onKnowledgeDraftsChange={(drafts) => {
              setSaveMessage(null);
              saveMutation.reset();
              setKnowledgeDrafts(normalizeKnowledgeDrafts(drafts));
            }}
          />
        }
        artifactContent={
          <ContentBrowserSurface
            scopedProjectId={props.projectId}
            preferredTab="artifacts"
            showHeader={false}
          />
        }
        memoryContent={<ProjectDetailMemoryTab projectId={props.projectId} />}
      />
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
  knowledge: Record<string, unknown>,
): Record<string, unknown> {
  const existing = asRecord(project?.settings);
  return {
    ...existing,
    knowledge,
    project_brief: projectContext.trim(),
  };
}

function buildProjectKnowledgeRecord(
  knowledgeDrafts: StructuredEntryDraft[],
): Record<string, unknown> {
  return buildStructuredObject(normalizeKnowledgeDrafts(knowledgeDrafts), 'Project knowledge') ?? {};
}

function buildProjectSpecPayload(
  spec: DashboardProjectSpecRecord | undefined,
  knowledge: Record<string, unknown>,
): Record<string, unknown> {
  return {
    config: knowledge,
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

function hasRecord(value: unknown): boolean {
  return Object.keys(asRecord(value)).length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readKnowledgeValidationError(drafts: StructuredEntryDraft[]): string | null {
  try {
    buildProjectKnowledgeRecord(drafts);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Project knowledge is not valid yet.';
  }
}

function readMutationError(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  return error ? 'Failed to save project knowledge.' : null;
}
