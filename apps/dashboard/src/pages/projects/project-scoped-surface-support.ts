export type ProjectScopedWorkspace = 'documents' | 'artifacts' | 'memory';

export interface ProjectScopedSurfaceDefinition {
  title: string;
  description: string;
  breadcrumbLabel: string;
}

interface ProjectIdentityInput {
  name?: string | null;
  slug?: string | null;
}

export interface ProjectScopedIdentity {
  title: string;
  slug: string | null;
}

export function resolveProjectScopedIdentity(
  projectId: string,
  project?: ProjectIdentityInput | null,
): ProjectScopedIdentity {
  const name = typeof project?.name === 'string' && project.name.trim().length > 0
    ? project.name.trim()
    : null;
  const slug = typeof project?.slug === 'string' && project.slug.trim().length > 0
    ? project.slug.trim()
    : null;
  return {
    title: name ?? slug ?? projectId,
    slug,
  };
}

export function buildProjectScopedSurfaceDefinition(
  workspace: ProjectScopedWorkspace,
): ProjectScopedSurfaceDefinition {
  if (workspace === 'artifacts') {
    return {
      title: 'Artifacts',
      breadcrumbLabel: 'Knowledge',
      description: 'Project-scoped view of the same artifact evidence available from Knowledge.',
    };
  }

  if (workspace === 'memory') {
    return {
      title: 'Memory',
      breadcrumbLabel: 'Knowledge',
      description: 'Project-scoped view of the same shared memory available from Knowledge.',
    };
  }

  return {
    title: 'Run content',
    breadcrumbLabel: 'Knowledge',
    description: 'Project-scoped view of the same run content available from Knowledge.',
  };
}
