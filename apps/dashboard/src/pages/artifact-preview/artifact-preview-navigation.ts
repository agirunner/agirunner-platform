export type ArtifactPreviewReturnSource =
  | 'workspace-artifacts'
  | 'workspace-content'
  | 'workflow-board'
  | 'workflow-inspector'
  | 'task-record';

interface SearchParamReader {
  get(name: string): string | null;
}

export function buildArtifactPermalink(
  taskId: string,
  artifactId: string,
  options?: {
    returnTo?: string | null;
    returnSource?: ArtifactPreviewReturnSource | null;
  },
): string {
  const path = `/artifacts/tasks/${encodeURIComponent(taskId)}/${encodeURIComponent(artifactId)}`;
  const searchParams = new URLSearchParams();
  if (options?.returnTo) {
    searchParams.set('return_to', options.returnTo);
  }
  if (options?.returnSource) {
    searchParams.set('return_source', options.returnSource);
  }
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export function readArtifactPreviewReturnState(searchParams: SearchParamReader): {
  returnTo: string | null;
  returnSource: ArtifactPreviewReturnSource | null;
} {
  return {
    returnTo: readOptionalParam(searchParams, 'return_to'),
    returnSource: readReturnSource(searchParams.get('return_source')),
  };
}

function readOptionalParam(
  searchParams: SearchParamReader,
  name: string,
): string | null {
  const value = searchParams.get(name)?.trim();
  return value ? value : null;
}

function readReturnSource(value: string | null): ArtifactPreviewReturnSource | null {
  return value === 'workspace-artifacts'
    || value === 'workspace-content'
    || value === 'workflow-board'
    || value === 'workflow-inspector'
    || value === 'task-record'
    ? value
    : null;
}
