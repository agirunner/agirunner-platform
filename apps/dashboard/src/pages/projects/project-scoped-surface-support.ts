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
      title: 'Artifact evidence',
      breadcrumbLabel: 'Artifact evidence',
      description:
        'Focused delivery evidence review for the same project-scoped outputs surfaced from the project knowledge workspace.',
    };
  }

  if (workspace === 'memory') {
    return {
      title: 'Project memory',
      breadcrumbLabel: 'Project memory',
      description:
        'Focused project and work-item memory review for the same knowledge workspace used on the main project page.',
    };
  }

  return {
    title: 'Run content',
    breadcrumbLabel: 'Run content',
    description:
      'Focused workflow documents and task artifacts for this project. This stays distinct from project reference material in the knowledge workspace.',
  };
}
