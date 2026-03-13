import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardHeader, CardTitle } from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { useUnsavedChanges } from '../../lib/use-unsaved-changes.js';
import {
  buildPlatformInstructionDraftStatus,
  buildPlatformInstructionSummaryCards,
  chooseComparedPlatformInstructionVersion,
  buildPlatformInstructionVersionLabel,
} from './platform-instructions-support.js';
import {
  ClearPlatformInstructionsDialog,
  PlatformInstructionDraftControls,
  PlatformInstructionOverviewCards,
  PlatformInstructionSummaryCards,
} from './platform-instructions-sections.js';
import {
  PlatformInstructionDiffCard,
  PlatformInstructionEditorCard,
  PlatformInstructionEmptyState,
} from './platform-instructions-page.content.js';

export function PlatformInstructionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editorContent, setEditorContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [showClearDialog, setShowClearDialog] = useState(false);

  const currentQuery = useQuery({
    queryKey: ['platform-instructions'],
    queryFn: () => dashboardApi.getPlatformInstructions(),
  });
  const versionsQuery = useQuery({
    queryKey: ['platform-instructions', 'versions'],
    queryFn: () => dashboardApi.listPlatformInstructionVersions(),
  });

  const currentInstruction = currentQuery.data;
  const versions = versionsQuery.data ?? [];
  const comparedVersion = useMemo(
    () => versions.find((version) => String(version.version) === selectedVersion) ?? null,
    [selectedVersion, versions],
  );

  useUnsavedChanges(hasUnsavedChanges);

  useEffect(() => {
    if (!currentInstruction) {
      return;
    }
    setEditorContent(currentInstruction.content);
    setHasUnsavedChanges(false);
  }, [currentInstruction?.content, currentInstruction?.version]);

  useEffect(() => {
    const fallbackVersion = chooseComparedPlatformInstructionVersion(
      versions,
      currentInstruction?.version ?? 0,
    );
    if (!fallbackVersion) {
      setSelectedVersion('');
      return;
    }
    setSelectedVersion((current) =>
      current && versions.some((version) => String(version.version) === current)
        ? current
        : String(fallbackVersion.version),
    );
  }, [currentInstruction?.version, versions]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      dashboardApi.updatePlatformInstructions({
        content: editorContent,
        format: 'markdown',
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['platform-instructions'], updated);
      await queryClient.invalidateQueries({ queryKey: ['platform-instructions', 'versions'] });
      setHasUnsavedChanges(false);
      toast.success(`Saved platform instructions as v${updated.version}.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to save platform instructions.');
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (!comparedVersion) {
        throw new Error('Choose a saved version before restoring.');
      }
      if (comparedVersion.version === currentInstruction?.version) {
        throw new Error('Select an older version to restore.');
      }
      return dashboardApi.updatePlatformInstructions({
        content: comparedVersion.content,
        format: comparedVersion.format === 'text' ? 'text' : 'markdown',
      });
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(['platform-instructions'], updated);
      await queryClient.invalidateQueries({ queryKey: ['platform-instructions', 'versions'] });
      toast.success(`Restored platform instructions from v${comparedVersion?.version} into v${updated.version}.`);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to restore platform instructions.',
      );
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => dashboardApi.clearPlatformInstructions(),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['platform-instructions'], updated);
      await queryClient.invalidateQueries({ queryKey: ['platform-instructions', 'versions'] });
      setShowClearDialog(false);
      toast.success(`Cleared platform instructions in v${updated.version}.`);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to clear platform instructions.',
      );
    },
  });

  if (currentQuery.isLoading || versionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (currentQuery.error || versionsQuery.error || !currentInstruction) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load platform instructions.
        </div>
      </div>
    );
  }

  const isBusy =
    saveMutation.isPending || restoreMutation.isPending || clearMutation.isPending;
  const canRestore =
    comparedVersion !== null && comparedVersion.version !== currentInstruction.version;
  const diffTarget = comparedVersion ?? currentInstruction;
  const summaryCards = buildPlatformInstructionSummaryCards(
    currentInstruction,
    versions,
    editorContent,
    hasUnsavedChanges,
  );
  const draftStatus = buildPlatformInstructionDraftStatus(
    currentInstruction,
    editorContent,
    hasUnsavedChanges,
  );
  const selectedVersionLabel = comparedVersion
    ? buildPlatformInstructionVersionLabel(comparedVersion, currentInstruction.version)
    : 'No saved version selected';

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">Platform Instructions</h1>
            <Badge variant="outline">v{currentInstruction.version}</Badge>
            <Badge variant="secondary">{currentInstruction.format ?? 'text'}</Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted">
            Configure the system-wide baseline instructions used by orchestrators and specialists.
            Version history, restore, and clear operations are persisted and auditable.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 xl:hidden">
          <Button
            variant="outline"
            onClick={() => setShowClearDialog(true)}
            disabled={isBusy || currentInstruction.content.length === 0}
          >
            <Trash2 className="h-4 w-4" />
            Clear Current
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={isBusy || !hasUnsavedChanges}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Current Draft
          </Button>
        </div>
      </div>

      <PlatformInstructionSummaryCards cards={summaryCards} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <PlatformInstructionOverviewCards
            currentInstruction={currentInstruction}
            comparedVersion={comparedVersion}
            versions={versions}
            selectedVersion={selectedVersion}
            onSelectedVersionChange={setSelectedVersion}
            onRestore={() => restoreMutation.mutate()}
            isBusy={isBusy}
            canRestore={canRestore}
            isRestoring={restoreMutation.isPending}
          />

          <PlatformInstructionEmptyState
            show={editorContent.length === 0 && !hasUnsavedChanges}
          />
          <PlatformInstructionEditorCard
            value={editorContent}
            hasUnsavedChanges={hasUnsavedChanges}
            currentContent={currentInstruction.content}
            onChange={(nextValue) => {
              setEditorContent(nextValue);
              setHasUnsavedChanges(nextValue !== currentInstruction.content);
            }}
          />
          <PlatformInstructionDiffCard
            oldText={diffTarget.content}
            newText={editorContent}
            oldLabel={comparedVersion ? `v${comparedVersion.version}` : 'Saved version'}
            newLabel={hasUnsavedChanges ? 'Current draft' : `v${currentInstruction.version} current`}
          />
        </div>

        <div className="space-y-6">
          <PlatformInstructionDraftControls
            status={draftStatus}
            canSave={hasUnsavedChanges}
            canClear={currentInstruction.content.length > 0}
            canRestore={canRestore}
            selectedVersionLabel={selectedVersionLabel}
            isBusy={isBusy}
            isSaving={saveMutation.isPending}
            isRestoring={restoreMutation.isPending}
            onSave={() => saveMutation.mutate()}
            onClear={() => setShowClearDialog(true)}
            onRestore={() => restoreMutation.mutate()}
          />
        </div>
      </div>

      <ClearPlatformInstructionsDialog
        open={showClearDialog}
        currentInstruction={currentInstruction}
        isClearing={clearMutation.isPending}
        onOpenChange={setShowClearDialog}
        onClear={() => clearMutation.mutate()}
      />
    </div>
  );
}
