import { useParams } from 'react-router-dom';

import { ContentBrowserSurface } from './content-browser-page.js';

export function ProjectContentBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return <ContentBrowserSurface scopedProjectId={params.id ?? ''} preferredTab="documents" />;
}
