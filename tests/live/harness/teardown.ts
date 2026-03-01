import { execSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

function safeExec(command: string): string {
  try {
    return execSync(command, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

function composeBinary(): string {
  try {
    execSync('docker compose version', { stdio: 'ignore' });
    return 'docker compose';
  } catch {
    // fall through
  }

  try {
    execSync('docker-compose version', { stdio: 'ignore' });
    return 'docker-compose';
  } catch {
    return '';
  }
}

function listTempArtifacts(): string[] {
  const tmpRoot = '/tmp';
  try {
    return readdirSync(tmpRoot)
      .filter((entry) => entry.startsWith('agentbaton-live-'))
      .map((entry) => path.join(tmpRoot, entry));
  } catch {
    return [];
  }
}

export function teardownLiveEnvironment(): {
  leakedContainers: number;
  leakedTempFiles: number;
} {
  const compose = composeBinary();
  if (compose) {
    safeExec(`${compose} down -v --remove-orphans`);
  }
  safeExec('docker volume prune -f');

  const projectName = process.env.COMPOSE_PROJECT_NAME ?? 'agentbaton-platform';
  const leaked = safeExec(
    `docker ps -a --filter label=com.docker.compose.project=${projectName} --format '{{.ID}}'`,
  )
    .split('\n')
    .filter(Boolean);

  const tempArtifacts = listTempArtifacts();
  for (const entry of tempArtifacts) {
    rmSync(entry, { recursive: true, force: true });
  }

  return {
    leakedContainers: leaked.length,
    leakedTempFiles: tempArtifacts.length,
  };
}
