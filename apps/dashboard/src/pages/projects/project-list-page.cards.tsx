import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import {
  CreateProjectDialog,
  DeleteProjectDialog,
  EditProjectDialog,
} from './project-list-page.dialogs.js';
import {
  buildProjectAttentionLabel,
  buildProjectDescription,
  buildProjectMetrics,
  buildProjectReadiness,
} from './project-list-page.support.js';

const QUIET_LINK_CLASS_NAME =
  'rounded-sm text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const QUIET_BUTTON_CLASS_NAME =
  'rounded-sm text-sm font-medium text-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ProjectListGrid(props: {
  projects: DashboardProjectRecord[];
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {props.projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

export function ProjectListEmptyState(): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <FolderOpen className="h-12 w-12 text-muted" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No projects yet</p>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Create the first project, add a short description, and then use the project links to
            continue deeper work in settings, delivery, or knowledge.
          </p>
        </div>
        <CreateProjectDialog buttonLabel="Create first project" buttonClassName="w-full sm:w-auto" />
      </CardContent>
    </Card>
  );
}

export function ProjectListFilteredEmptyState(props: {
  onShowInactive: () => void;
}): JSX.Element {
  return (
    <Card className="border-border/70 bg-card/80 shadow-none">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="space-y-1">
          <p className="font-medium text-foreground">No active projects to show</p>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Every project in this list is inactive right now. Use the filter to review paused
            workspaces.
          </p>
        </div>
        <Button variant="outline" onClick={props.onShowInactive}>
          Show inactive
        </Button>
      </CardContent>
    </Card>
  );
}

function ProjectCard(props: {
  project: DashboardProjectRecord;
}): JSX.Element {
  const [showDelete, setShowDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const projectLinkState = { projectLabel: props.project.name };
  const readiness = buildProjectReadiness(props.project);
  const attentionLabel = buildProjectAttentionLabel(props.project);
  const projectMetrics = buildProjectMetrics(props.project);

  return (
    <>
      <Card className="overflow-hidden border-border/70 bg-card/80 shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <CardTitle className="text-base leading-6">
            <Link
              to={`/projects/${props.project.id}`}
              state={projectLinkState}
              className="rounded-sm underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {props.project.name}
            </Link>
          </CardTitle>
          <Badge variant={readiness.variant}>{readiness.label}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-muted">{buildProjectDescription(props.project)}</p>
          {projectMetrics ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <p className="font-medium text-muted">{projectMetrics}</p>
              {attentionLabel ? <Badge variant="warning">{attentionLabel}</Badge> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <Link
              className={QUIET_LINK_CLASS_NAME}
              to={`/projects/${props.project.id}?tab=settings`}
              state={projectLinkState}
            >
              Settings
            </Link>
            <Link
              className={QUIET_LINK_CLASS_NAME}
              to={`/projects/${props.project.id}?tab=knowledge`}
              state={projectLinkState}
            >
              Knowledge
            </Link>
            <Link
              className={QUIET_LINK_CLASS_NAME}
              to={`/projects/${props.project.id}?tab=automation`}
              state={projectLinkState}
            >
              Automation
            </Link>
            <Link
              className={QUIET_LINK_CLASS_NAME}
              to={`/projects/${props.project.id}?tab=delivery`}
              state={projectLinkState}
            >
              Delivery
            </Link>
            <button
              type="button"
              className={QUIET_BUTTON_CLASS_NAME}
              onClick={() => setShowEdit(true)}
            >
              Edit basics
            </button>
            <button
              type="button"
              className={QUIET_BUTTON_CLASS_NAME}
              onClick={() => setShowDelete(true)}
              data-testid={`delete-project-${props.project.id}`}
            >
              Delete
            </button>
          </div>
        </CardContent>
      </Card>
      {showDelete ? (
        <DeleteProjectDialog project={props.project} onClose={() => setShowDelete(false)} />
      ) : null}
      {showEdit ? (
        <EditProjectDialog project={props.project} onClose={() => setShowEdit(false)} />
      ) : null}
    </>
  );
}
