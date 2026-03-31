import { DEFAULT_TENANT_ID } from '../platform-env.js';
import { runPsql, ensureNonLiveRuntimeQuiesced, pruneOrphanedWorkflowArtifactDirectories } from './runtime.js';
import { buildFixturePurgeSql } from './queries.js';
import {
  selectFixturePlaybookIds,
  selectFixtureWorkflowIds,
  selectFixtureWorkspaceIds,
  selectBlockingWorkflows,
  selectTenantWorkflowIds,
} from './selection.js';

export async function resetWorkflowsState(): Promise<void> {
  ensureNonLiveRuntimeQuiesced();
  const fixtureWorkspaceIds = selectFixtureWorkspaceIds();
  const fixturePlaybookIds = selectFixturePlaybookIds();
  const blockingWorkflows = selectBlockingWorkflows();
  const fixtureWorkflowIds = selectFixtureWorkflowIds();

  if (blockingWorkflows.length > 0) {
    throw new Error(
      `Refusing to seed dashboard E2E workflows over active non-fixture workflows: ${blockingWorkflows
        .map((workflow) => `${workflow.name ?? workflow.id} (${workflow.id})`)
        .join(', ')}`,
    );
  }

  if (
    fixtureWorkflowIds.length === 0
    && fixtureWorkspaceIds.length === 0
    && fixturePlaybookIds.length === 0
  ) {
    return;
  }

  runPsql(buildFixturePurgeSql());
  pruneOrphanedWorkflowArtifactDirectories(DEFAULT_TENANT_ID, selectTenantWorkflowIds());
}
