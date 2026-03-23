import { useEffect, useState } from 'react';

import {
  formatArtifactPreviewText,
  renderArtifactPreviewMarkup,
} from '../../components/artifact-preview/artifact-preview-support.js';
import { Badge } from '../../components/ui/badge.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs.js';
import type {
  ArtifactPreviewDescriptor,
} from '../../components/artifact-preview/artifact-preview-support.js';
import type { WorkspaceArtifactEntry } from './workspace-artifact-explorer-support.js';
import {
  WorkspaceArtifactExplorerList,
  WorkspaceArtifactQuickInspector,
} from './workspace-artifact-explorer-presentation.js';

export function WorkspaceArtifactExplorerAdaptiveLayout(props: {
  artifactCount: number;
  selectedArtifactName: string | null;
  previewDescriptor: ArtifactPreviewDescriptor | null;
  previewContentText: string | null;
  previewState: { isLoading: boolean; error: string | null };
  artifacts: WorkspaceArtifactEntry[];
  isLoading: boolean;
  pagination: {
    page: number;
    totalPages: number;
    totalArtifacts: number;
    pageSize: number;
    onPrevious(): void;
    onNext(): void;
  };
  listSelection: {
    selectedArtifactId: string;
    selectedArtifactIds: string[];
    onSelectArtifact(artifactId: string): void;
    onToggleArtifact(artifactId: string): void;
  };
  selectedArtifact: WorkspaceArtifactEntry | null;
  buildPreviewHref(artifact: WorkspaceArtifactEntry): string;
}): JSX.Element {
  const [mobileView, setMobileView] = useState<'browse' | 'inspect'>('browse');

  useEffect(() => {
    if (props.selectedArtifactName) {
      setMobileView('inspect');
    }
  }, [props.selectedArtifactName]);

  return (
    <>
      <div className="space-y-4 xl:hidden">
        <div className="rounded-2xl bg-muted/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Review mode</p>
              <p className="text-sm text-muted">
                {props.selectedArtifactName
                  ? `Inspecting ${props.selectedArtifactName}. Switch back to the list to compare another artifact.`
                  : 'Browse artifacts first, then switch to inspection for preview, metadata, and linked context.'}
              </p>
            </div>
            <Badge variant="secondary">{props.artifactCount} visible</Badge>
          </div>
        </div>

        <Tabs
          className="space-y-4"
          value={mobileView}
          onValueChange={(value) => setMobileView(value as 'browse' | 'inspect')}
        >
          <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="browse">Artifact list</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
        </TabsList>
          <TabsContent value="browse" className="space-y-4">
            <ArtifactListPane
              artifacts={props.artifacts}
              isLoading={props.isLoading}
              pagination={props.pagination}
              selection={props.listSelection}
              buildPreviewHref={props.buildPreviewHref}
            />
          </TabsContent>
          <TabsContent value="inspect" className="space-y-4">
            <ArtifactInspectorPane
              selectedArtifact={props.selectedArtifact}
              previewDescriptor={props.previewDescriptor}
              previewContentText={props.previewContentText}
              previewState={props.previewState}
              buildPreviewHref={props.buildPreviewHref}
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="hidden gap-6 xl:grid xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
        <ArtifactListPane
          artifacts={props.artifacts}
          isLoading={props.isLoading}
          pagination={props.pagination}
          selection={props.listSelection}
          buildPreviewHref={props.buildPreviewHref}
        />
        <ArtifactInspectorPane
          selectedArtifact={props.selectedArtifact}
          previewDescriptor={props.previewDescriptor}
          previewContentText={props.previewContentText}
          previewState={props.previewState}
          buildPreviewHref={props.buildPreviewHref}
        />
      </div>
    </>
  );
}

function ArtifactListPane(props: {
  artifacts: WorkspaceArtifactEntry[];
  isLoading: boolean;
  pagination: {
    page: number;
    totalPages: number;
    totalArtifacts: number;
    pageSize: number;
    onPrevious(): void;
    onNext(): void;
  };
  selection: {
    selectedArtifactId: string;
    selectedArtifactIds: string[];
    onSelectArtifact(artifactId: string): void;
    onToggleArtifact(artifactId: string): void;
  };
  buildPreviewHref(artifact: WorkspaceArtifactEntry): string;
}): JSX.Element {
  return (
    <WorkspaceArtifactExplorerList
      artifacts={props.artifacts}
      isLoading={props.isLoading}
      pagination={props.pagination}
      selectedArtifactId={props.selection.selectedArtifactId}
      selectedArtifactIds={props.selection.selectedArtifactIds}
      onSelectArtifact={props.selection.onSelectArtifact}
      onToggleArtifact={props.selection.onToggleArtifact}
      buildPreviewHref={props.buildPreviewHref}
    />
  );
}

function ArtifactInspectorPane(props: {
  selectedArtifact: WorkspaceArtifactEntry | null;
  previewDescriptor: ArtifactPreviewDescriptor | null;
  previewContentText: string | null;
  previewState: { isLoading: boolean; error: string | null };
  buildPreviewHref(artifact: WorkspaceArtifactEntry): string;
}): JSX.Element {
  return (
    <WorkspaceArtifactQuickInspector
      artifact={props.selectedArtifact}
      previewMarkup={
        props.previewDescriptor && props.previewContentText
          ? renderArtifactPreviewMarkup(props.previewContentText, props.previewDescriptor)
          : ''
      }
      previewText={
        props.previewDescriptor && props.previewContentText
          ? formatArtifactPreviewText(props.previewContentText, props.previewDescriptor)
          : ''
      }
      previewKind={props.previewDescriptor?.kind ?? 'binary'}
      isPreviewLoading={props.previewState.isLoading}
      previewError={props.previewState.error}
      previewHref={
        props.selectedArtifact ? props.buildPreviewHref(props.selectedArtifact) : null
      }
    />
  );
}
