import { useParams } from 'react-router-dom';

import { LogsSurface } from '../mission-control/logs-page.js';

export function WorkflowInspectorPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  return <LogsSurface scopedWorkflowId={params.id ?? ''} />;
}
