import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

function cmd(command: string, cwd = process.cwd()): string {
  return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

export function validateCleanup(): string[] {
  const validations: string[] = [];

  const leakedContainers = cmd(
    'docker ps -a --filter label=com.docker.compose.project=agentbaton-platform --format "{{.ID}}"',
  )
    .split('\n')
    .filter(Boolean);
  if (leakedContainers.length > 0) {
    throw new Error(`Detected leaked compose containers: ${leakedContainers.join(', ')}`);
  }
  validations.push('containers_clean');

  const tmpRoot = path.join(process.cwd(), 'tests/live/tmp');
  if (existsSync(tmpRoot)) {
    const leftovers = readdirSync(tmpRoot);
    if (leftovers.length > 0) {
      throw new Error(`Detected leaked temp files in ${tmpRoot}`);
    }
  }
  validations.push('temp_files_clean');

  const fixtureRoot = path.join(process.cwd(), 'tests/live/fixtures');
  const contaminatedCanonicalFixtures = readdirSync(fixtureRoot)
    .map((name) => path.join(fixtureRoot, name))
    .filter((repoPath) => existsSync(path.join(repoPath, '.git')));

  if (contaminatedCanonicalFixtures.length > 0) {
    throw new Error(
      `Canonical fixtures contaminated with .git state: ${contaminatedCanonicalFixtures.join(', ')}`,
    );
  }
  validations.push('canonical_fixtures_clean');

  return validations;
}
