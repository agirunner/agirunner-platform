import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/button.js';
import { readProjectArtifactRouteState } from '../../lib/artifact-navigation.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { ProjectArtifactExplorerPanel } from './project-artifact-explorer-panel.js';

export function ProjectArtifactBrowserPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const projectId = params.id?.trim() ?? '';
  const projectPath = projectId ? `/projects/${projectId}` : '/projects';
  const contentPath = projectId ? `/projects/${projectId}/content` : '/projects';
  const memoryPath = projectId ? `/projects/${projectId}/memory` : '/projects';
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
      <section className="space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">
              Project operator surface
            </p>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight">Project Artifact Explorer</h1>
              <p className="max-w-3xl text-sm text-muted">
                Review delivery artifacts, trace them back to workflow execution, and decide the
                next follow-up without leaving the current project scope.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={projectPath}>Back to Project</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={contentPath}>Open Documents</Link>
            </Button>
            <Button asChild size="sm">
              <Link to={memoryPath}>Cross-check Memory</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ArtifactFocusCard
            title="Review scope"
            description="Stay inside the current project and narrow the list to the workflow, work item, or step that needs operator review."
          />
          <ArtifactFocusCard
            title="Best next step"
            description="Open the selected artifact first, then confirm whether the related document, work item, or memory record needs follow-up."
          />
          <ArtifactFocusCard
            title="Cross-check provenance"
            description="Use the explorer to confirm which workflow turn produced the artifact before you approve, rework, or archive it."
          />
        </div>
      </section>

      <ProjectArtifactExplorerPanel
        key={panelKey}
        projectId={projectId}
        showHeader={false}
        initialRouteState={initialRouteState}
      />
    </div>
  );
}

function ArtifactFocusCard(props: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-sm font-semibold">{props.title}</CardTitle>
        <CardDescription className="text-sm leading-6">{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted">
        Keep the artifact list as the working pane and use the project actions above when you need
        to pivot into adjacent operator flows.
      </CardContent>
    </Card>
  );
}
