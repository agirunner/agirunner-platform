export type ArtifactPreviewReturnSource =
  | 'project-artifacts'
  | 'project-content'
  | 'workflow-board'
  | 'workflow-inspector'
  | 'task-record';

export type ProjectArtifactRoutePreviewMode = 'all' | 'inline' | 'download';
export type ProjectArtifactRouteSort =
  | 'newest'
  | 'oldest'
  | 'largest'
  | 'smallest'
  | 'name';

interface SearchParamReader {
  get(name: string): string | null;
}

export interface ProjectArtifactRouteState {
  query: string;
  workflowId: string;
  workItemId: string;
  taskId: string;
  stageName: string;
  role: string;
  contentType: string;
  previewMode: ProjectArtifactRoutePreviewMode;
  createdFrom: string;
  createdTo: string;
  sort: ProjectArtifactRouteSort;
  page: number;
  artifactId: string;
}

export const DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE: ProjectArtifactRouteState = {
  query: '',
  workflowId: '',
  workItemId: '',
  taskId: '',
  stageName: '',
  role: '',
  contentType: '',
  previewMode: 'all',
  createdFrom: '',
  createdTo: '',
  sort: 'newest',
  page: 1,
  artifactId: '',
};

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

export function readProjectArtifactRouteState(
  searchParams: SearchParamReader,
): ProjectArtifactRouteState {
  return {
    query: readOptionalParam(searchParams, 'q') ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.query,
    workflowId:
      readOptionalParam(searchParams, 'workflow_id')
      ?? readOptionalParam(searchParams, 'workflow')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.workflowId,
    workItemId:
      readOptionalParam(searchParams, 'work_item_id')
      ?? readOptionalParam(searchParams, 'work_item')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.workItemId,
    taskId:
      readOptionalParam(searchParams, 'task_id') ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.taskId,
    stageName:
      readOptionalParam(searchParams, 'stage_name')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.stageName,
    role: readOptionalParam(searchParams, 'role') ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.role,
    contentType:
      readOptionalParam(searchParams, 'content_type')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.contentType,
    previewMode:
      readPreviewMode(searchParams.get('preview_mode'))
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.previewMode,
    createdFrom:
      readOptionalParam(searchParams, 'created_from')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.createdFrom,
    createdTo:
      readOptionalParam(searchParams, 'created_to')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.createdTo,
    sort:
      readSort(searchParams.get('sort')) ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.sort,
    page: readPage(searchParams.get('page')),
    artifactId:
      readOptionalParam(searchParams, 'artifact_id')
      ?? DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.artifactId,
  };
}

export function buildProjectArtifactBrowserPath(
  projectId: string,
  state: Partial<ProjectArtifactRouteState>,
): string {
  const searchParams = new URLSearchParams();
  appendStateParam(searchParams, 'q', state.query);
  appendStateParam(searchParams, 'workflow_id', state.workflowId);
  appendStateParam(searchParams, 'work_item_id', state.workItemId);
  appendStateParam(searchParams, 'task_id', state.taskId);
  appendStateParam(searchParams, 'stage_name', state.stageName);
  appendStateParam(searchParams, 'role', state.role);
  appendStateParam(searchParams, 'content_type', state.contentType);
  if (state.previewMode && state.previewMode !== 'all') {
    searchParams.set('preview_mode', state.previewMode);
  }
  appendStateParam(searchParams, 'created_from', state.createdFrom);
  appendStateParam(searchParams, 'created_to', state.createdTo);
  if (state.sort && state.sort !== 'newest') {
    searchParams.set('sort', state.sort);
  }
  if (typeof state.page === 'number' && Number.isInteger(state.page) && state.page > 1) {
    searchParams.set('page', String(state.page));
  }
  appendStateParam(searchParams, 'artifact_id', state.artifactId);
  const query = searchParams.toString();
  const path = `/projects/${encodeURIComponent(projectId)}/artifacts`;
  return query ? `${path}?${query}` : path;
}

function appendStateParam(
  searchParams: URLSearchParams,
  name: string,
  value: string | null | undefined,
): void {
  if (!value) {
    return;
  }
  searchParams.set(name, value);
}

function readOptionalParam(
  searchParams: SearchParamReader,
  name: string,
): string | null {
  const value = searchParams.get(name)?.trim();
  return value ? value : null;
}

function readPreviewMode(value: string | null): ProjectArtifactRoutePreviewMode | null {
  return value === 'inline' || value === 'download' || value === 'all' ? value : null;
}

function readSort(value: string | null): ProjectArtifactRouteSort | null {
  return value === 'newest'
    || value === 'oldest'
    || value === 'largest'
    || value === 'smallest'
    || value === 'name'
    ? value
    : null;
}

function readReturnSource(value: string | null): ArtifactPreviewReturnSource | null {
  return value === 'project-artifacts'
    || value === 'project-content'
    || value === 'workflow-board'
    || value === 'workflow-inspector'
    || value === 'task-record'
    ? value
    : null;
}

function readPage(value: string | null): number {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return DEFAULT_PROJECT_ARTIFACT_ROUTE_STATE.page;
  }
  return page;
}
