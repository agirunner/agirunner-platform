import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import type { DashboardWorkspaceRecord, DashboardWorkspaceSpecRecord } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import {
  buildStructuredObject,
  objectToStructuredDrafts,
  type WorkspaceOverview,
  type StructuredEntryDraft,
} from './workspace-detail-support.js';
import { ErrorCard, LoadingCard } from './workspace-detail-shared.js';
import { WorkspaceArtifactFilesPanel } from './workspace-artifact-files-panel.js';
import { WorkspaceDetailMemoryTab } from './workspace-detail-memory-tab.js';
import { WorkspaceKnowledgeShell } from './workspace-knowledge-shell.js';
import { WorkspaceSpecTab } from './workspace-spec-tab.js';

const EMPTY_SPEC_SECTION = {};

export function WorkspaceKnowledgeTab(props: {
  workspaceId: string;
  overview: WorkspaceOverview;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [knowledgeDrafts, setKnowledgeDrafts] = useState<StructuredEntryDraft[]>([]);
  const [memoryDrafts, setMemoryDrafts] = useState<StructuredEntryDraft[]>([]);
  const [workspaceContext, setWorkspaceContext] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ['workspace', props.workspaceId],
    queryFn: () => dashboardApi.getWorkspace(props.workspaceId),
  });
  const specQuery = useQuery({
    queryKey: ['workspace-spec', props.workspaceId],
    queryFn: () => dashboardApi.getWorkspaceSpec(props.workspaceId),
  });

  useEffect(() => {
    if (!specQuery.data) {
      return;
    }
    setKnowledgeDrafts(toKnowledgeDrafts(specQuery.data));
  }, [specQuery.data]);

  useEffect(() => {
    if (!workspaceQuery.data) {
      return;
    }
    setWorkspaceContext(readWorkspaceContext(workspaceQuery.data));
    setMemoryDrafts(toMemoryDrafts(workspaceQuery.data));
  }, [workspaceQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextKnowledge = buildWorkspaceKnowledgeRecord(knowledgeDrafts);
      const nextMemory = buildWorkspaceMemoryRecord(memoryDrafts);
      const nextSpec = buildWorkspaceSpecPayload(specQuery.data, nextKnowledge);
      const nextSettings = buildWorkspaceSettingsPatch(workspaceQuery.data, workspaceContext, nextKnowledge);
      const currentMemory = asRecord(workspaceQuery.data?.memory);

      await Promise.all([
        dashboardApi.updateWorkspaceSpec(props.workspaceId, nextSpec),
        dashboardApi.patchWorkspace(props.workspaceId, { settings: nextSettings }),
      ]);
      await syncWorkspaceMemory(props.workspaceId, currentMemory, nextMemory);
    },
    onSuccess: async () => {
      setSaveMessage('Knowledge and memory saved.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace-spec', props.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', props.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      ]);
    },
  });

  const knowledgeValidationError = readStructuredValidationError(knowledgeDrafts, 'Workspace knowledge');
  const memoryValidationError = readStructuredValidationError(memoryDrafts, 'Workspace memory');
  const mutationError = readMutationError(saveMutation.error);
  const validationError = knowledgeValidationError ?? memoryValidationError;

  if (workspaceQuery.isLoading || specQuery.isLoading) {
    return <LoadingCard />;
  }

  if (workspaceQuery.error || specQuery.error) {
    return <ErrorCard message="Failed to load workspace knowledge." />;
  }

  return (
    <div className="space-y-3">
      <WorkspaceKnowledgeShell
        workspaceId={props.workspaceId}
        overview={props.overview}
        headerNotice={saveMessage ? <p className="text-sm text-muted">{saveMessage}</p> : null}
        referenceSummary={buildReferenceDraftSummary(workspaceContext, knowledgeDrafts.length)}
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
          <WorkspaceSpecTab
            workspaceContext={workspaceContext}
            knowledgeDrafts={knowledgeDrafts}
            saveErrorMessage={knowledgeValidationError ?? mutationError}
            onWorkspaceContextChange={(value) => {
              setSaveMessage(null);
              saveMutation.reset();
              setWorkspaceContext(value);
            }}
            onKnowledgeDraftsChange={(drafts) => {
              setSaveMessage(null);
              saveMutation.reset();
              setKnowledgeDrafts(normalizeKnowledgeDrafts(drafts));
            }}
          />
        }
        artifactContent={
          <WorkspaceArtifactFilesPanel workspaceId={props.workspaceId} />
        }
        memoryContent={
          <WorkspaceDetailMemoryTab
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

function readWorkspaceContext(workspace: DashboardWorkspaceRecord): string {
  const settings = asRecord(workspace.settings);
  return typeof settings.workspace_brief === 'string' ? settings.workspace_brief : '';
}

function buildWorkspaceSettingsPatch(
  workspace: DashboardWorkspaceRecord | undefined,
  workspaceContext: string,
  knowledge: Record<string, unknown>,
): Record<string, unknown> {
  const existing = asRecord(workspace?.settings);
  return {
    ...existing,
    knowledge,
    workspace_brief: workspaceContext.trim(),
  };
}

function buildWorkspaceKnowledgeRecord(
  knowledgeDrafts: StructuredEntryDraft[],
): Record<string, unknown> {
  return buildStructuredObject(normalizeKnowledgeDrafts(knowledgeDrafts), 'Workspace knowledge') ?? {};
}

function buildWorkspaceMemoryRecord(
  memoryDrafts: StructuredEntryDraft[],
): Record<string, unknown> {
  return buildStructuredObject(memoryDrafts, 'Workspace memory') ?? {};
}

function buildWorkspaceSpecPayload(
  spec: DashboardWorkspaceSpecRecord | undefined,
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

function toKnowledgeDrafts(spec: DashboardWorkspaceSpecRecord): StructuredEntryDraft[] {
  return normalizeKnowledgeDrafts(objectToStructuredDrafts(spec.config));
}

function toMemoryDrafts(workspace: DashboardWorkspaceRecord): StructuredEntryDraft[] {
  return normalizeMemoryDrafts(objectToStructuredDrafts(asRecord(workspace.memory)));
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

function buildReferenceDraftSummary(workspaceContext: string, knowledgeCount: number): string {
  const summary = [
    workspaceContext.trim().length > 0 ? 'Workspace Context: Configured' : 'Workspace Context: Not configured',
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
  return error ? 'Failed to save workspace knowledge.' : null;
}

async function syncWorkspaceMemory(
  workspaceId: string,
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
        ? dashboardApi.removeWorkspaceMemory(workspaceId, operation.key)
        : dashboardApi.patchWorkspaceMemory(workspaceId, {
            key: operation.key,
            value: operation.value,
          }),
    ),
  );
}

function areMemoryValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
