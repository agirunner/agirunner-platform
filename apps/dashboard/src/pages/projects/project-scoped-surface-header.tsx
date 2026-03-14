import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
import { Badge } from '../../components/ui/badge.js';
import {
  buildProjectScopedSurfaceDefinition,
  resolveProjectScopedIdentity,
  type ProjectScopedWorkspace,
} from './project-scoped-surface-support.js';

export function ProjectScopedSurfaceHeader(props: {
  projectId: string;
  workspace: ProjectScopedWorkspace;
}): JSX.Element {
  const definition = buildProjectScopedSurfaceDefinition(props.workspace);
  const location = useLocation();
  const navigate = useNavigate();
  const projectQuery = useQuery({
    queryKey: ['project', props.projectId],
    queryFn: () => dashboardApi.getProject(props.projectId),
    enabled: props.projectId.trim().length > 0,
  });
  const projectIdentity = resolveProjectScopedIdentity(props.projectId, projectQuery.data);
  const projectTitle = projectQuery.data ? projectIdentity.title : 'Project';
  const projectSlug = projectQuery.data ? projectIdentity.slug : null;

  useEffect(() => {
    if (!projectQuery.data) {
      return;
    }
    const currentState = location.state && typeof location.state === 'object'
      ? location.state as Record<string, unknown>
      : {};
    if (currentState.projectLabel === projectTitle) {
      return;
    }
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      {
        replace: true,
        state: { ...currentState, projectLabel: projectTitle },
      },
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
    projectQuery.data,
    projectTitle,
  ]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
        <Link
          className="transition-colors hover:text-foreground"
          to={`/projects/${props.projectId}?tab=knowledge`}
        >
          Project knowledge
        </Link>
        <span>/</span>
        <span>{definition.breadcrumbLabel}</span>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-medium text-foreground">{projectTitle}</span>
          {projectSlug ? <Badge variant="outline">{projectSlug}</Badge> : null}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{definition.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">{definition.description}</p>
      </div>
    </section>
  );
}
