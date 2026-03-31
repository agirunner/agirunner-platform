import { WorkspaceTimelineService } from '../../../src/services/workspace-timeline-service.js';

export function createWorkspaceTimelineService(query: unknown) {
  return new WorkspaceTimelineService({ query } as never);
}
