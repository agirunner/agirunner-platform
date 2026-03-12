import { useParams } from 'react-router-dom';

import { MemoryBrowserSurface } from './memory-browser-page.js';

export function ProjectMemoryBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return <MemoryBrowserSurface scopedProjectId={params.id ?? ''} />;
}
