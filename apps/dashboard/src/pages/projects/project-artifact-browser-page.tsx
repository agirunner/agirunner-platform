import { useParams } from 'react-router-dom';

import { ProjectArtifactExplorerPanel } from './project-artifact-explorer-panel.js';

export function ProjectArtifactBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return (
    <div className="space-y-6 p-6">
      <ProjectArtifactExplorerPanel projectId={params.id ?? ''} showHeader />
    </div>
  );
}
