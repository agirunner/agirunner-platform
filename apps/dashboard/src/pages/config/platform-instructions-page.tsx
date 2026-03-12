import type { ComponentType } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import MonacoEditor from '@monaco-editor/react';
import { FileText, Loader2, Save, Trash2 } from 'lucide-react';

import { DiffViewer } from '../../components/diff-viewer.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { dashboardApi } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { chooseComparedPlatformInstructionVersion } from './platform-instructions-support.js';
import {
  ClearPlatformInstructionsDialog,
  PlatformInstructionOverviewCards,
} from './platform-instructions-sections.js';

const Editor = MonacoEditor as unknown as ComponentType<{
  height: string;
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  options?: Record<string, unknown>;
}>;

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
        <div className="flex flex-wrap gap-2">
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

      {editorContent.length === 0 && !hasUnsavedChanges ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted">
            <FileText className="h-12 w-12" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">No active platform instructions</p>
              <p className="text-sm">
                Draft the baseline operator guidance below, then save it as a persisted platform
                version.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Instructions Editor</CardTitle>
          <p className="text-sm text-muted">
            Edit the live draft directly. Unsaved changes are diffed against the selected saved
            version below.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-border">
            <Editor
              height="55vh"
              language="markdown"
              value={editorContent}
              onChange={(value) => {
                const nextValue = value ?? '';
                setEditorContent(nextValue);
                setHasUnsavedChanges(nextValue !== currentInstruction.content);
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          </div>
          {hasUnsavedChanges ? (
            <p className="mt-3 text-xs text-amber-600">You have unsaved changes in the current draft.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Saved Version Diff</CardTitle>
          <p className="text-sm text-muted">
            Review how the selected saved version differs from the current editor state before
            saving or restoring.
          </p>
        </CardHeader>
        <CardContent>
          <DiffViewer
            oldText={diffTarget.content}
            newText={editorContent}
            oldLabel={comparedVersion ? `v${comparedVersion.version}` : 'Saved version'}
            newLabel={hasUnsavedChanges ? 'Current draft' : `v${currentInstruction.version} current`}
          />
        </CardContent>
      </Card>

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
