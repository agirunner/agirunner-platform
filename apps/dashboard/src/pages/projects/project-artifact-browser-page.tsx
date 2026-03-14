import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { readProjectArtifactRouteState } from '../../lib/artifact-navigation.js';
import { ProjectArtifactExplorerPanel } from './project-artifact-explorer-panel.js';
import { ProjectScopedSurfaceHeader } from './project-scoped-surface-header.js';

export function ProjectArtifactBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const projectId = params.id?.trim() ?? '';
  const initialRouteState = useMemo(
    () => readProjectArtifactRouteState(searchParams),
    [searchParams],
  );
  const panelKey = useMemo(
    () => `${projectId}:${searchParams.toString()}`,
    [projectId, searchParams],
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <ProjectScopedSurfaceHeader projectId={projectId} workspace="artifacts" />

      <ProjectArtifactExplorerPanel
        key={panelKey}
        projectId={projectId}
        showHeader={false}
        initialRouteState={initialRouteState}
      />
    </div>
  );
}
