function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface RepositoryBranchContextInput {
  environment?: unknown;
  parameters?: unknown;
  workflowGitBranch?: unknown;
  workspaceDefaultBranch?: string | null;
}

export interface RepositoryBranchContext {
  baseBranch: string | null;
  featureBranch: string | null;
  branch: string | null;
}

export function resolveRepositoryBranchContext(
  input: RepositoryBranchContextInput,
): RepositoryBranchContext {
  const environment = readRecord(input.environment);
  const parameters = readRecord(input.parameters);
  const workspaceDefaultBranch = readString(input.workspaceDefaultBranch);
  const workflowGitBranch = readString(input.workflowGitBranch);

  const explicitBaseBranch =
    readString(environment.base_branch)
    ?? readString(environment.baseBranch)
    ?? readString(parameters.base_branch);
  const explicitFeatureBranch =
    readString(environment.branch)
    ?? readString(parameters.feature_branch)
    ?? readString(parameters.target_branch);
  const branchParameter = readString(parameters.branch);
  const inferredWorkflowFeatureBranch =
    workflowGitBranch && workspaceDefaultBranch && workflowGitBranch !== workspaceDefaultBranch
      ? workflowGitBranch
      : null;

  const baseBranch =
    explicitBaseBranch
    ?? workspaceDefaultBranch
    ?? workflowGitBranch
    ?? branchParameter
    ?? explicitFeatureBranch;
  const featureBranch = explicitFeatureBranch ?? branchParameter ?? inferredWorkflowFeatureBranch;
  const branch = readString(environment.branch) ?? featureBranch ?? baseBranch;

  return {
    baseBranch,
    featureBranch,
    branch,
  };
}
