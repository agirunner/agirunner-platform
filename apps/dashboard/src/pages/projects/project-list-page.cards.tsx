import { useState } from 'react';
import { FolderOpen, GitBranch, Pencil, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { DashboardProjectRecord } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { DeleteProjectDialog, EditProjectDialog } from './project-list-page.dialogs.js';
import {
  formatProjectCreatedAt,
  statusVariant,
  type ProjectListPacket,
} from './project-list-page.support.js';

export function ProjectListPackets(props: {
  packets: ProjectListPacket[];
}): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {props.packets.map((packet) => (
        <Card key={packet.label} className="border-border/70 bg-card/80 shadow-none">
          <CardHeader className="space-y-1 pb-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
              {packet.label}
            </div>
            <CardTitle className="text-lg">{packet.value}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm leading-6 text-muted">
            {packet.detail}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

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
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <FolderOpen className="h-12 w-12 text-muted" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">No projects yet</p>
          <p className="text-sm leading-6 text-muted">
            Create the first workspace, connect its repository, and then launch board work from the
            project detail page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectCard(props: {
  project: DashboardProjectRecord;
}): JSX.Element {
  const [showDelete, setShowDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  return (
    <>
      <Card className="border-border/70 bg-card/80 shadow-none">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">{props.project.name}</CardTitle>
              <p className="text-xs text-muted">{props.project.slug}</p>
            </div>
            <Badge variant={statusVariant(props.project.is_active)}>
              {props.project.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted">
            {props.project.description?.trim()
              ? props.project.description
              : 'Add a short project brief so operators know what belongs in this workspace.'}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <div className="rounded-xl border border-border/70 bg-background/70 p-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
              Repository posture
            </div>
            <div className="mt-1 flex items-center gap-2 font-medium text-foreground">
              <GitBranch className="h-4 w-4" />
              {props.project.repository_url ? 'Repository linked' : 'Repository not linked yet'}
            </div>
            <p className="mt-1 text-sm leading-6 text-muted">
              {props.project.repository_url
                ? props.project.repository_url
                : 'Connect the repository so specialists can clone, edit, and push from this project.'}
            </p>
          </div>
          <div className="text-xs text-muted">
            Created {formatProjectCreatedAt(props.project.created_at)}
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <Button asChild className="gap-2">
            <Link to={`/projects/${props.project.id}`}>Open project</Link>
          </Button>
          <Button variant="outline" onClick={() => setShowEdit(true)} className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit details
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowDelete(true)}
            className="gap-2"
            data-testid={`delete-project-${props.project.slug}`}
          >
            <Trash2 className="h-4 w-4" />
            Delete project
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
