import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ValidationError } from '../../../errors/domain-errors.js';

const execFile = promisify(execFileCallback);
const DEFAULT_GIT_VERIFY_TIMEOUT_SECONDS = 15;
const DEFAULT_GIT_VERIFY_USERNAME = 'token';

export interface VerifyWorkspaceGitAccessInput {
  repositoryUrl: string;
  defaultBranch?: string | null;
  gitToken?: string | null;
}

export interface VerifyWorkspaceGitAccessResult {
  ok: true;
  repository_url: string;
  default_branch: string | null;
  branch_verified: boolean;
}

interface ExecFileResult {
  stdout: string;
  stderr: string;
}

type ExecFileFn = (
  file: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxBuffer?: number;
  },
) => Promise<ExecFileResult>;

export class WorkspaceGitAccessVerifier {
  private readonly timeoutMs: number;
  private readonly credentialUsername: string;
  private readonly execFile: ExecFileFn;

  constructor(options?: {
    timeoutSeconds?: number;
    credentialUsername?: string;
    execFile?: ExecFileFn;
  }) {
    this.timeoutMs = resolveTimeoutMs(options?.timeoutSeconds);
    this.credentialUsername = resolveCredentialUsername(options?.credentialUsername);
    this.execFile = options?.execFile ?? execFile;
  }

  async verify(input: VerifyWorkspaceGitAccessInput): Promise<VerifyWorkspaceGitAccessResult> {
    const repositoryUrl = input.repositoryUrl.trim();
    const defaultBranch = normalizeOptionalString(input.defaultBranch);
    const gitToken = normalizeOptionalString(input.gitToken);
    const auth = await prepareGitAuth({
      repositoryUrl,
      credentialUsername: this.credentialUsername,
      gitToken,
    });

    try {
      const repoVerified = await this.runLsRemote(auth.env, repositoryUrl, 'HEAD');
      if (!repoVerified) {
        throw new ValidationError('Repository could not be verified with the supplied Git access.');
      }

      const branchVerified = defaultBranch
        ? await this.runLsRemote(auth.env, repositoryUrl, `refs/heads/${defaultBranch}`)
        : false;

      if (defaultBranch && !branchVerified) {
        throw new ValidationError(`Default branch "${defaultBranch}" could not be verified.`);
      }

      return {
        ok: true,
        repository_url: repositoryUrl,
        default_branch: defaultBranch,
        branch_verified: branchVerified,
      };
    } finally {
      await auth.cleanup();
    }
  }

  private async runLsRemote(
    env: NodeJS.ProcessEnv,
    repositoryUrl: string,
    ref: string,
  ): Promise<boolean> {
    try {
      const result = await this.execFile(
        'git',
        ['ls-remote', repositoryUrl, ref],
        {
          env,
          timeout: this.timeoutMs,
          maxBuffer: 1024 * 1024,
        },
      );
      return result.stdout.trim().length > 0;
    } catch (error) {
      throw toGitValidationError(error, repositoryUrl, ref);
    }
  }
}

async function prepareGitAuth(input: {
  repositoryUrl: string;
  credentialUsername: string;
  gitToken: string | null;
}): Promise<{ env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  if (!input.gitToken) {
    return {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
      cleanup: async () => undefined,
    };
  }

  let repositoryUrl: URL;
  try {
    repositoryUrl = new URL(input.repositoryUrl);
  } catch {
    throw new ValidationError('Repository URL must be a valid URL.');
  }

  const workspaceRoot = await mkdtemp(join(tmpdir(), 'workspace-git-verify-'));
  const runtimeDir = join(workspaceRoot, '.runtime');
  const credentialsDir = join(workspaceRoot, 'credentials');
  const credentialsFile = join(credentialsDir, 'git-credentials');
  const gitConfigFile = join(runtimeDir, 'gitconfig');

  await mkdir(runtimeDir, { recursive: true });
  await mkdir(credentialsDir, { recursive: true });

  const scheme = repositoryUrl.protocol.replace(/:$/, '') || 'https';
  const credentialLine = `${scheme}://${input.credentialUsername}:${input.gitToken}@${repositoryUrl.host}\n`;
  await writeFile(credentialsFile, credentialLine, { encoding: 'utf8', mode: 0o400 });
  await chmod(credentialsFile, 0o400);

  const env = {
    ...process.env,
    HOME: workspaceRoot,
    GIT_CONFIG_GLOBAL: gitConfigFile,
    GIT_TERMINAL_PROMPT: '0',
  };

  await execFile(
    'git',
    ['config', '--global', 'credential.helper', `store --file=${credentialsFile}`],
    {
      env,
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    },
  );

  return {
    env,
    cleanup: async () => {
      await rm(workspaceRoot, { recursive: true, force: true });
    },
  };
}

function resolveTimeoutMs(timeoutSeconds?: number): number {
  const value = timeoutSeconds ?? DEFAULT_GIT_VERIFY_TIMEOUT_SECONDS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('workspace git verify timeout must be positive');
  }
  return value * 1000;
}

function resolveCredentialUsername(value?: string): string {
  const normalized = normalizeOptionalString(value);
  return normalized ?? DEFAULT_GIT_VERIFY_USERNAME;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toGitValidationError(error: unknown, repositoryUrl: string, ref: string): ValidationError {
  const stderr = readErrorText(error);
  const target = ref === 'HEAD' ? 'repository' : `branch "${ref.replace(/^refs\/heads\//, '')}"`;
  if (stderr.includes('authentication failed') || stderr.includes('could not read username')) {
    return new ValidationError(`Git access failed while verifying the ${target}. Check the repository token.`);
  }
  if (stderr.includes('repository not found')) {
    return new ValidationError(`Git access failed because the repository could not be found: ${repositoryUrl}`);
  }
  if (stderr.includes('remote branch') && stderr.includes('not found')) {
    return new ValidationError(`Git access failed because ${target} was not found.`);
  }
  if (stderr.includes('operation timed out') || stderr.includes('timed out')) {
    return new ValidationError(`Git access verification timed out while checking the ${target}.`);
  }
  return new ValidationError(`Git access verification failed while checking the ${target}.`);
}

function readErrorText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const stderr =
    'stderr' in error && typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr
      : '';
  const message =
    'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  return `${stderr}\n${message}`.toLowerCase();
}
