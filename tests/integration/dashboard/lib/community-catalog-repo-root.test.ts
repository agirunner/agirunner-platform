import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveCommunityCatalogRepoRoot } from './community-catalog-repo-root.js';

test('resolveCommunityCatalogRepoRoot prefers the manifest-backed sibling checkout over a stale nested path', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'community-catalog-repo-root-'));
  const repoRoot = join(workspaceRoot, 'agirunner-platform');
  const siblingPlaybooksRoot = join(workspaceRoot, 'agirunner-playbooks');
  const staleNestedRoot = join(workspaceRoot, 'agirunner', 'agirunner-playbooks');

  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(join(siblingPlaybooksRoot, 'catalog'), { recursive: true });
  mkdirSync(staleNestedRoot, { recursive: true });
  writeFileSync(join(siblingPlaybooksRoot, 'catalog', 'playbooks.yaml'), 'catalog_version: 1\nplaybooks: []\n');

  try {
    assert.equal(resolveCommunityCatalogRepoRoot(repoRoot), siblingPlaybooksRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
