import { useState } from 'react';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.js';
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

const PROJECT_WORKSPACE_LINKS = [
  { label: 'Settings', tab: 'settings' },
  { label: 'Knowledge', tab: 'knowledge' },
  { label: 'Automation', tab: 'automation' },
  { label: 'Delivery', tab: 'delivery' },
] as const;

const CALM_ATTENTION_BADGE_CLASS_NAME =
  'border-amber-300/60 bg-amber-50/70 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100';
const PRIMARY_WORKSPACE_LINK_CLASS_NAME =
  'group flex items-center justify-between rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const DANGER_BUTTON_CLASS_NAME =
  '!text-red-700 hover:bg-red-50 hover:!text-red-800 dark:!text-red-200 dark:hover:bg-red-500/10';

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
        <CardHeader className="space-y-3 pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base leading-6">
              <Link
                to={`/projects/${props.project.id}`}
                state={projectLinkState}
                className="rounded-sm underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {props.project.name}
              </Link>
            </CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {attentionLabel ? (
                <Badge variant="outline" className={CALM_ATTENTION_BADGE_CLASS_NAME}>
                  {attentionLabel}
                </Badge>
              ) : null}
              <Badge variant={readiness.variant}>{readiness.label}</Badge>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted">{buildProjectDescription(props.project)}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs font-medium text-muted">{projectMetrics}</p>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
              Open workspace
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PROJECT_WORKSPACE_LINKS.map((workspace) => (
                <Link
                  key={workspace.tab}
                  className={PRIMARY_WORKSPACE_LINK_CLASS_NAME}
                  to={`/projects/${props.project.id}?tab=${workspace.tab}`}
                  state={projectLinkState}
                >
                  <span>{workspace.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-1 pt-0">
          <Button variant="ghost" size="sm" type="button" onClick={() => setShowEdit(true)}>
            Edit basics
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className={DANGER_BUTTON_CLASS_NAME}
            onClick={() => setShowDelete(true)}
            data-testid={`delete-project-${props.project.id}`}
          >
            Delete
          </Button>
        </CardFooter>
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
