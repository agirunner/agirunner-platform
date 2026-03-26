import type { ComponentType } from 'react';

import MonacoEditor from '@monaco-editor/react';
import { FileText } from 'lucide-react';

import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { DiffViewer } from '../../components/diff-viewer/diff-viewer.js';
import { Card, CardContent } from '../../components/ui/card.js';

const Editor = MonacoEditor as unknown as ComponentType<{
  height: string;
  language: string;
  value: string;
  onChange?: (value: string | undefined) => void;
  options?: Record<string, unknown>;
}>;

export function PlatformInstructionEmptyState(props: {
  show: boolean;
}): JSX.Element | null {
  if (!props.show) {
    return null;
  }
  return (
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
  );
}

export function PlatformInstructionEditorCard(props: {
  value: string;
  hasUnsavedChanges: boolean;
  currentContent: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <DashboardSectionCard
      id="platform-instructions-editor"
      title="Instructions Editor"
      description="Edit the live draft directly. Unsaved changes are diffed against the selected saved version below."
    >
        <div className="overflow-hidden rounded-lg border border-border">
          <Editor
            height="55vh"
            language="markdown"
            value={props.value}
            onChange={(value) => props.onChange(value ?? '')}
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
        {props.hasUnsavedChanges ? (
          <p className="mt-3 text-xs text-amber-600">You have unsaved changes in the current draft.</p>
        ) : null}
    </DashboardSectionCard>
  );
}

export function PlatformInstructionDiffCard(props: {
  oldText: string;
  newText: string;
  oldLabel: string;
  newLabel: string;
}): JSX.Element {
  return (
    <DashboardSectionCard
      id="platform-instructions-diff"
      title="Saved Version Diff"
      description="Review how the selected saved version differs from the current editor state before saving or restoring."
    >
        <DiffViewer
          oldText={props.oldText}
          newText={props.newText}
          oldLabel={props.oldLabel}
          newLabel={props.newLabel}
        />
    </DashboardSectionCard>
  );
}
