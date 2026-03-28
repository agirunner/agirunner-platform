import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { dashboardApi } from '../../lib/api.js';
import { Button } from '../../components/ui/button.js';
import {
  DEFAULT_FORM_VALIDATION_MESSAGE,
  FormFeedbackMessage,
  resolveFormFeedbackMessage,
} from '../../components/forms/form-feedback.js';
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

export function WorkspaceKnowledgeTab(props: {
  workspaceId: string;
  overview: WorkspaceOverview;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [memoryDrafts, setMemoryDrafts] = useState<StructuredEntryDraft[]>([]);
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const workspaceQuery = useQuery({
    queryKey: ['workspace', props.workspaceId],
    queryFn: () => dashboardApi.getWorkspace(props.workspaceId),
  });

  useEffect(() => {
    if (!workspaceQuery.data) {
      return;
    }
    setMemoryDrafts(toMemoryDrafts(workspaceQuery.data));
    setHasAttemptedSave(false);
  }, [workspaceQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nextMemory = buildWorkspaceMemoryRecord(memoryDrafts);
      const currentMemory = asRecord(workspaceQuery.data?.memory);
      await syncWorkspaceMemory(props.workspaceId, currentMemory, nextMemory);
    },
    onSuccess: async () => {
      setSaveMessage('Workspace memory saved.');
      setHasAttemptedSave(false);
      await queryClient.invalidateQueries({ queryKey: ['workspace', props.workspaceId] });
    },
  });

  const memoryValidationError = readStructuredValidationError(memoryDrafts, 'Workspace memory');
  const mutationError = readMutationError(saveMutation.error);
  const validationError = memoryValidationError;
  const formFeedbackMessage = resolveFormFeedbackMessage({
    serverError: mutationError,
    showValidation: hasAttemptedSave,
    isValid: !validationError,
    validationMessage: DEFAULT_FORM_VALIDATION_MESSAGE,
  });

  if (workspaceQuery.isLoading) {
    return <LoadingCard />;
  }

  if (workspaceQuery.error) {
    return <ErrorCard message="Failed to load workspace knowledge." />;
  }

  return (
    <div className="space-y-3">
      <WorkspaceKnowledgeShell
        overview={props.overview}
        headerNotice={saveMessage ? <p className="text-sm text-muted">{saveMessage}</p> : null}
        headerFeedback={<FormFeedbackMessage message={formFeedbackMessage} />}
        memorySummary={buildMemoryDraftSummary(memoryDrafts.length)}
        headerAction={
          <Button
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => {
              if (validationError) {
                setHasAttemptedSave(true);
                return;
              }
              saveMutation.mutate();
            }}
          >
            <Save className="h-4 w-4" />
            Save memory
          </Button>
        }
        artifactContent={
          <WorkspaceArtifactFilesPanel workspaceId={props.workspaceId} />
        }
        memoryContent={
          <WorkspaceDetailMemoryTab
            memoryDrafts={memoryDrafts}
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

function buildWorkspaceMemoryRecord(
  memoryDrafts: StructuredEntryDraft[],
): Record<string, unknown> {
  return buildStructuredObject(memoryDrafts, 'Workspace memory') ?? {};
}

function toMemoryDrafts(workspace: { memory?: Record<string, unknown> | null }): StructuredEntryDraft[] {
  return normalizeMemoryDrafts(objectToStructuredDrafts(asRecord(workspace.memory)));
}

function normalizeMemoryDrafts(drafts: StructuredEntryDraft[]): StructuredEntryDraft[] {
  return drafts.map((draft) => ({
    ...draft,
    valueType: draft.valueType === 'json' ? 'json' : 'string',
  }));
}

function buildMemoryDraftSummary(memoryCount: number): string {
  void memoryCount;
  return 'Evolving notes and learned state stay here as work progresses.';
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
  return error ? 'Failed to save workspace memory.' : null;
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
