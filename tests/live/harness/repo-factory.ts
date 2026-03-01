import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const FIXTURE_ROOT = path.join(ROOT, 'tests/live/fixtures');

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
  run('git commit -m "chore(fixtures): baseline state"', repoDir);
}

export function resetFixtureRepos(): string[] {
  if (!existsSync(FIXTURE_ROOT)) {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
  }

  const touched: string[] = [];

  for (const name of readdirSync(FIXTURE_ROOT)) {
    const repoDir = path.join(FIXTURE_ROOT, name);
    if (!existsSync(path.join(repoDir, 'package.json'))) {
      continue;
    }

    ensureGitBaseline(repoDir);
    touched.push(repoDir);
  }

  return touched;
}
