import { useParams } from 'react-router-dom';

import { ContentBrowserSurface } from './content-browser-page.js';

export function ProjectArtifactBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return <ContentBrowserSurface scopedProjectId={params.id ?? ''} preferredTab="artifacts" />;
}
