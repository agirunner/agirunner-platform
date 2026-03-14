import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { dashboardApi } from '../../lib/api.js';
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
  const projectLabel =
    projectTitle === 'Project'
      ? null
      : projectSlug && projectSlug !== projectTitle
        ? `${projectTitle} (${projectSlug})`
        : projectTitle;

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
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link
          className="transition-colors hover:text-foreground"
          to={`/projects/${props.projectId}?tab=knowledge`}
        >
          Back to Knowledge
        </Link>
        {projectLabel ? (
          <>
            <span aria-hidden="true">/</span>
            <span>{projectLabel}</span>
          </>
        ) : null}
      </div>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{definition.title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">{definition.description}</p>
      </div>
    </section>
  );
}
