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
import { ProjectArtifactFilesPanel } from './project-artifact-files-panel.js';
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
  const [memoryDrafts, setMemoryDrafts] = useState<StructuredEntryDraft[]>([]);
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
    setMemoryDrafts(toMemoryDrafts(projectQuery.data));
  }, [projectQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextKnowledge = buildProjectKnowledgeRecord(knowledgeDrafts);
      const nextMemory = buildProjectMemoryRecord(memoryDrafts);
      const nextSpec = buildProjectSpecPayload(specQuery.data, nextKnowledge);
      const nextSettings = buildProjectSettingsPatch(projectQuery.data, projectContext, nextKnowledge);
      const currentMemory = asRecord(projectQuery.data?.memory);

      await Promise.all([
        dashboardApi.updateProjectSpec(props.projectId, nextSpec),
        dashboardApi.patchProject(props.projectId, { settings: nextSettings }),
      ]);
      await syncProjectMemory(props.projectId, currentMemory, nextMemory);
    },
    onSuccess: async () => {
      setSaveMessage('Knowledge and memory saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-spec', props.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', props.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ]);
    },
  });

  const knowledgeValidationError = readStructuredValidationError(knowledgeDrafts, 'Project knowledge');
  const memoryValidationError = readStructuredValidationError(memoryDrafts, 'Project memory');
  const mutationError = readMutationError(saveMutation.error);
  const validationError = knowledgeValidationError ?? memoryValidationError;

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
        referenceSummary={buildReferenceDraftSummary(projectContext, knowledgeDrafts.length)}
        memorySummary={buildMemoryDraftSummary(memoryDrafts.length)}
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
            saveErrorMessage={knowledgeValidationError ?? mutationError}
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
          <ProjectArtifactFilesPanel projectId={props.projectId} />
        }
        memoryContent={
          <ProjectDetailMemoryTab
            memoryDrafts={memoryDrafts}
            saveErrorMessage={memoryValidationError ?? mutationError}
            onMemoryDraftsChange={(drafts) => {
              setSaveMessage(null);
              saveMutation.reset();
              setMemoryDrafts(normalizeMemoryDrafts(drafts));
            }}
          />
        }
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

function buildProjectMemoryRecord(
  memoryDrafts: StructuredEntryDraft[],
): Record<string, unknown> {
  return buildStructuredObject(memoryDrafts, 'Project memory') ?? {};
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

function toMemoryDrafts(project: DashboardProjectRecord): StructuredEntryDraft[] {
  return normalizeMemoryDrafts(objectToStructuredDrafts(asRecord(project.memory)));
}

function normalizeKnowledgeDrafts(drafts: StructuredEntryDraft[]): StructuredEntryDraft[] {
  return drafts.map((draft) => ({
    ...draft,
    valueType: draft.valueType === 'json' ? 'json' : 'string',
  }));
}

function normalizeMemoryDrafts(drafts: StructuredEntryDraft[]): StructuredEntryDraft[] {
  return drafts.map((draft) => ({
    ...draft,
    valueType: draft.valueType === 'json' ? 'json' : 'string',
  }));
}

function buildReferenceDraftSummary(projectContext: string, knowledgeCount: number): string {
  const summary = [
    projectContext.trim().length > 0 ? 'Project Context: Configured' : 'Project Context: Not configured',
    `Knowledge entries: ${knowledgeCount} ${knowledgeCount === 1 ? 'entry' : 'entries'}`,
  ];
  return summary.join(' • ');
}

function buildMemoryDraftSummary(memoryCount: number): string {
  return `Shared memory: ${memoryCount} ${memoryCount === 1 ? 'entry' : 'entries'}`;
}

function hasRecord(value: unknown): boolean {
  return Object.keys(asRecord(value)).length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStructuredValidationError(
  drafts: StructuredEntryDraft[],
  label: string,
): string | null {
  try {
    buildStructuredObject(drafts, label);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : `${label} is not valid yet.`;
  }
}

function readMutationError(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  return error ? 'Failed to save project knowledge.' : null;
}

async function syncProjectMemory(
  projectId: string,
  currentMemory: Record<string, unknown>,
  nextMemory: Record<string, unknown>,
): Promise<void> {
  type MemorySyncOperation =
    | { kind: 'delete'; key: string }
    | { kind: 'upsert'; key: string; value: unknown };

  const keys = new Set([...Object.keys(currentMemory), ...Object.keys(nextMemory)]);
  const operations = Array.from(keys)
    .sort((left, right) => left.localeCompare(right))
    .flatMap<MemorySyncOperation>((key) => {
      const currentValue = currentMemory[key];
      const hasCurrent = Object.prototype.hasOwnProperty.call(currentMemory, key);
      const hasNext = Object.prototype.hasOwnProperty.call(nextMemory, key);

      if (hasNext && hasCurrent && areMemoryValuesEqual(currentValue, nextMemory[key])) {
        return [];
      }
      if (!hasNext && hasCurrent) {
        return [{ kind: 'delete' as const, key }];
      }
      if (hasNext) {
        return [{ kind: 'upsert' as const, key, value: nextMemory[key] }];
      }
      return [];
    });

  await Promise.all(
    operations.map((operation) =>
      operation.kind === 'delete'
        ? dashboardApi.removeProjectMemory(projectId, operation.key)
        : dashboardApi.patchProjectMemory(projectId, {
            key: operation.key,
            value: operation.value,
          }),
    ),
  );
}

function areMemoryValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
