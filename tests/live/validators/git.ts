import { execSync } from 'node:child_process';

interface GitValidationOptions {
  expectedBranch?: string;
  expectedAuthorIncludes?: string;
  relevantPaths?: string[];
}

function output(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

export function verifyGitActivity(
  repoDir: string,
  options: GitValidationOptions = {},
): string[] {
  const checks: string[] = [];

  const commitCount = Number(output('git rev-list --count HEAD', repoDir));
  if (commitCount < 1) {
    throw new Error(`No commits found in ${repoDir}`);
  }
  checks.push('commits_exist');

  const branch = output('git rev-parse --abbrev-ref HEAD', repoDir);
  if (!branch) {
    throw new Error(`Branch resolution failed in ${repoDir}`);
  }
  if (options.expectedBranch && branch !== options.expectedBranch) {
    throw new Error(`Expected branch ${options.expectedBranch}, got ${branch}`);
  }
  checks.push(`branch:${branch}`);

  const author = output('git log -1 --pretty=format:%an <%ae>', repoDir);
  if (!author) {
    throw new Error(`Could not resolve latest commit author in ${repoDir}`);
  }
  if (options.expectedAuthorIncludes && !author.includes(options.expectedAuthorIncludes)) {
    throw new Error(
      `Latest commit author ${author} does not include ${options.expectedAuthorIncludes}`,
    );
  }
  checks.push(`author:${author}`);

  const diffStat = output('git show --stat --oneline -1', repoDir);
  if (!diffStat.includes('|')) {
    throw new Error(`Latest commit has no file changes in ${repoDir}`);
  }
  checks.push('non_empty_diff');

  const touchedFiles = output('git diff --name-only HEAD~1 HEAD', repoDir)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (options.relevantPaths && options.relevantPaths.length > 0) {
    const hit = touchedFiles.some((file) =>
      options.relevantPaths?.some((prefix) => file.startsWith(prefix)),
    );
    if (!hit) {
      throw new Error(
        `Latest commit diff does not touch relevant paths: ${options.relevantPaths.join(', ')}`,
      );
    }
  }
  checks.push(`diff_files:${touchedFiles.length}`);

  return checks;
}

export function verifyPullRequestMetadata(metadata: {
  exists: boolean;
  title?: string;
  expectedTitleIncludes?: string;
  linkedIssueId?: string;
}): string[] {
  if (!metadata.exists) {
    throw new Error('Expected PR to exist, but it does not');
  }

  if (metadata.expectedTitleIncludes) {
    if (!metadata.title?.includes(metadata.expectedTitleIncludes)) {
      throw new Error(
        `PR title ${metadata.title ?? '<none>'} does not include ${metadata.expectedTitleIncludes}`,
      );
    }
  }

  if (!metadata.linkedIssueId) {
    throw new Error('Expected PR to link to an issue, but linkedIssueId is missing');
  }

  return ['pr_exists', 'pr_title_matches', `pr_linked_issue:${metadata.linkedIssueId}`];
}
