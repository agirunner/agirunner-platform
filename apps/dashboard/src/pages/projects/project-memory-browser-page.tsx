import { useParams } from 'react-router-dom';

import { MemoryBrowserSurface } from './memory-browser-page.js';
import { ProjectScopedSurfaceHeader } from './project-scoped-surface-header.js';

export function ProjectMemoryBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const projectId = params.id ?? '';
  return (
    <div className="space-y-6 p-4 sm:p-6">
      <ProjectScopedSurfaceHeader projectId={projectId} workspace="memory" />
      <MemoryBrowserSurface scopedProjectId={projectId} showHeader={false} />
    </div>
  );
}
