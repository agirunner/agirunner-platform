import { useParams } from 'react-router-dom';

import { ContentBrowserSurface } from './content-browser-page.js';
import { ProjectScopedSurfaceHeader } from './project-scoped-surface-header.js';

export function ProjectContentBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const projectId = params.id ?? '';
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <ProjectScopedSurfaceHeader projectId={projectId} workspace="documents" />
      <ContentBrowserSurface scopedProjectId={projectId} preferredTab="documents" showHeader={false} />
    </div>
  );
}
