import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function resolveCommunityCatalogRepoRoot(
  repoRoot: string,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const siblingCandidate = resolve(repoRoot, '../agirunner-playbooks');
  const legacyNestedCandidate = resolve(repoRoot, '../../agirunner/agirunner-playbooks');
  const manifestCandidates = [siblingCandidate, legacyNestedCandidate];

  for (const candidate of manifestCandidates) {
    if (pathExists(resolve(candidate, 'catalog/playbooks.yaml'))) {
      return candidate;
    }
  }

  for (const candidate of manifestCandidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return siblingCandidate;
}
