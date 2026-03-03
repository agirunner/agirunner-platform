import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const CANONICAL_FIXTURE_ROOT = path.join(ROOT, 'tests/live/fixtures');
const DEFAULT_LIVE_TMP_PREFIX = '/tmp/agentbaton-live-';

function resolveLiveTmpPrefix(): string {
  const override = process.env.LIVE_TMP_PREFIX?.trim();
  return override && override.length > 0 ? override : DEFAULT_LIVE_TMP_PREFIX;
}

function run(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: 'ignore' });
}

function ensureGitBaseline(repoDir: string): void {
  const gitDir = path.join(repoDir, '.git');
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true, force: true });
  }

  run('git init -b main', repoDir);
  run('git config user.name "QA Automation"', repoDir);
  run('git config user.email "qa@users.noreply.github.com"', repoDir);
  run('git add .', repoDir);
  run('git commit -m "chore(fixtures): ephemeral baseline state"', repoDir);
}

function ensureCanonicalRoot(): void {
  if (!existsSync(CANONICAL_FIXTURE_ROOT)) {
    mkdirSync(CANONICAL_FIXTURE_ROOT, { recursive: true });
  }
}

function fixtureRunRoot(runId: string): string {
  return `${resolveLiveTmpPrefix()}${runId}`;
}

export interface FixtureWorkspace {
  runRoot: string;
  fixtureRoot: string;
  repos: string[];
}

/**
 * Prepare per-run ephemeral fixture clones from canonical platform-owned fixtures.
 * Canonical fixtures under tests/live/fixtures are never mutated by live runs.
 */
export function prepareFixtureWorkspace(runId: string): FixtureWorkspace {
  ensureCanonicalRoot();

  const runRoot = fixtureRunRoot(runId);
  const fixtureRoot = path.join(runRoot, 'fixtures');

  rmSync(runRoot, { recursive: true, force: true });
  mkdirSync(fixtureRoot, { recursive: true });

  const repos: string[] = [];

  for (const name of readdirSync(CANONICAL_FIXTURE_ROOT)) {
    const sourceDir = path.join(CANONICAL_FIXTURE_ROOT, name);
    const packageJson = path.join(sourceDir, 'package.json');
    if (!existsSync(packageJson)) {
      continue;
    }

    const targetDir = path.join(fixtureRoot, name);
    cpSync(sourceDir, targetDir, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return base !== '.git';
      },
    });

    ensureGitBaseline(targetDir);
    repos.push(targetDir);
  }

  process.env.LIVE_FIXTURE_ROOT = fixtureRoot;

  return {
    runRoot,
    fixtureRoot,
    repos,
  };
}

export function resolveFixtureRepoPath(name: string): string {
  const fixtureRoot = process.env.LIVE_FIXTURE_ROOT?.trim();
  if (fixtureRoot) {
    return path.join(fixtureRoot, name);
  }
  return path.join(CANONICAL_FIXTURE_ROOT, name);
}

export function cleanupFixtureWorkspace(runId: string): void {
  rmSync(fixtureRunRoot(runId), { recursive: true, force: true });
}
