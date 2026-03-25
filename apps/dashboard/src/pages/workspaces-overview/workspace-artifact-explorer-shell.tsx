import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import type { WorkspaceArtifactSummary } from './workspace-artifact-explorer-support.js';
import { WorkspaceArtifactExplorerSummary } from './workspace-artifact-explorer-presentation.js';

export function WorkspaceArtifactExplorerShell(props: {
  workspaceId: string;
  showHeader: boolean;
  summary: WorkspaceArtifactSummary;
  loadError: unknown;
  filterCard: JSX.Element;
  bulkActionBar: JSX.Element | null;
  adaptiveLayout: JSX.Element;
}): JSX.Element {
  return (
    <div className="space-y-6">
      {props.showHeader ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Workspace Artifact Explorer</h1>
              <p className="text-sm text-muted">
                Review delivery artifacts across workflows, work items, and tasks without leaving the workspace scope.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={`/design/workspaces/${props.workspaceId}`}>Back to Workspace</Link>
            </Button>
          </div>
        </div>
      ) : null}

      <WorkspaceArtifactExplorerSummary summary={props.summary} />
      {props.filterCard}
      {props.bulkActionBar}

      {props.loadError ? (
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">
            Failed to load workspace artifact scope.
          </CardContent>
        </Card>
      ) : (
        props.adaptiveLayout
      )}
    </div>
  );
}
