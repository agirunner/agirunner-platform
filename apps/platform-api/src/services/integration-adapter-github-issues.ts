import { ValidationError } from '../errors/domain-errors.js';
import { decryptWebhookSecret, encryptWebhookSecret } from './webhook-secret-crypto.js';

export interface PublicGitHubIssuesConfig {
  owner: string;
  repo: string;
  api_base_url: string;
  labels: string[];
  token_configured: boolean;
}

export interface StoredGitHubIssuesConfig {
  owner: string;
  repo: string;
  api_base_url: string;
  labels: string[];
  token: string;
}

export interface GitHubIssuesTarget {
  owner: string;
  repo: string;
  apiBaseUrl: string;
  labels: string[];
  token: string;
}

export interface GitHubIssueLink {
  externalId: string;
  externalUrl: string | null;
}

export interface TaskIssueSnapshot {
  id: string;
  title: string;
  type: string;
  state: string;
  priority: string;
  workflowId: string | null;
  input: Record<string, unknown>;
}

interface GitHubIssueRecord {
  number: number;
  html_url?: string;
}

export function normalizeStoredGitHubIssuesConfig(
  currentConfig: Record<string, unknown>,
  nextConfig: Record<string, unknown>,
  encryptionKey: string,
): StoredGitHubIssuesConfig {
  const current = readExistingStoredConfig(currentConfig);
  const owner = readRequiredString(nextConfig.owner, current?.owner, 'GitHub Issues adapter requires owner');
  const repo = readRequiredString(nextConfig.repo, current?.repo, 'GitHub Issues adapter requires repo');
  const token = normalizeToken(nextConfig.token, current?.token, encryptionKey);

  return {
    owner,
    repo,
    token,
    api_base_url: readApiBaseUrl(nextConfig.api_base_url, current?.api_base_url),
    labels: readLabels(nextConfig.labels, current?.labels ?? []),
  };
}

export function toPublicGitHubIssuesConfig(config: Record<string, unknown>): PublicGitHubIssuesConfig {
  const stored = readStoredConfig(config);
  return {
    owner: stored.owner,
    repo: stored.repo,
    api_base_url: stored.api_base_url,
    labels: stored.labels,
    token_configured: stored.token.length > 0,
  };
}

export function toGitHubIssuesTarget(
  config: Record<string, unknown>,
  encryptionKey: string,
): GitHubIssuesTarget {
  const stored = readStoredConfig(config);
  return {
    owner: stored.owner,
    repo: stored.repo,
    apiBaseUrl: stored.api_base_url,
    labels: stored.labels,
    token: decryptWebhookSecret(stored.token, encryptionKey),
  };
}

export async function syncGitHubIssue(
  fetchFn: typeof globalThis.fetch,
  target: GitHubIssuesTarget,
  task: TaskIssueSnapshot,
  existingLink: GitHubIssueLink | null,
): Promise<GitHubIssueLink> {
  if (!existingLink) {
    const response = await fetchJson<GitHubIssueRecord>(fetchFn, `${buildIssueBaseUrl(target)}/issues`, {
      method: 'POST',
      headers: buildHeaders(target.token),
      body: JSON.stringify({
        title: task.title,
        body: buildIssueBody(task),
        labels: target.labels,
      }),
    });
    return {
      externalId: String(response.number),
      externalUrl: response.html_url ?? null,
    };
  }

  const issueState = isTerminalTaskState(task.state) ? 'closed' : 'open';
  await fetchJson<GitHubIssueRecord>(
    fetchFn,
    `${buildIssueBaseUrl(target)}/issues/${existingLink.externalId}`,
    {
      method: 'PATCH',
      headers: buildHeaders(target.token),
      body: JSON.stringify({
        title: task.title,
        body: buildIssueBody(task),
        state: issueState,
      }),
    },
  );

  return existingLink;
}

function buildIssueBaseUrl(target: GitHubIssuesTarget): string {
  return `${target.apiBaseUrl.replace(/\/$/, '')}/repos/${target.owner}/${target.repo}`;
}

function buildIssueBody(task: TaskIssueSnapshot): string {
  const summary = readTaskSummary(task.input);
  const lines = [
    `Agirunner task: ${task.id}`,
    `State: ${task.state}`,
    `Type: ${task.type}`,
    `Priority: ${task.priority}`,
  ];
  if (task.workflowId) {
    lines.push(`Workflow: ${task.workflowId}`);
  }
  if (summary) {
    lines.push('', summary);
  }
  return lines.join('\n');
}

function readTaskSummary(input: Record<string, unknown>): string | null {
  const candidates = [input.description, input.objective, input.brief];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function isTerminalTaskState(state: string): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'skipped';
}

function buildHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'Agirunner',
  };
}

async function fetchJson<T>(fetchFn: typeof globalThis.fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetchFn(url, init);
  if (!response.ok) {
    throw new Error(`GitHub Issues adapter failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function normalizeToken(nextToken: unknown, currentToken: string | undefined, encryptionKey: string): string {
  if (nextToken === undefined) {
    if (currentToken) {
      return currentToken;
    }
    throw new ValidationError('GitHub Issues adapter requires token');
  }
  if (typeof nextToken !== 'string' || nextToken.trim().length < 8) {
    throw new ValidationError('GitHub Issues adapter token must be at least 8 characters');
  }
  return encryptWebhookSecret(nextToken, encryptionKey);
}

function readApiBaseUrl(nextValue: unknown, currentValue: string | undefined): string {
  const value = typeof nextValue === 'string' ? nextValue : currentValue ?? 'https://api.github.com';
  if (!/^https?:\/\//.test(value)) {
    throw new ValidationError('GitHub Issues adapter requires an http(s) api_base_url');
  }
  return value;
}

function readLabels(nextValue: unknown, fallback: string[]): string[] {
  if (nextValue === undefined) {
    return fallback;
  }
  if (!Array.isArray(nextValue) || nextValue.some((entry) => typeof entry !== 'string')) {
    throw new ValidationError('GitHub Issues adapter labels must be an array of strings');
  }
  return nextValue.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function readRequiredString(value: unknown, fallback: string | undefined, message: string): string {
  const resolved = typeof value === 'string' ? value : fallback;
  if (!resolved || resolved.trim().length === 0) {
    throw new ValidationError(message);
  }
  return resolved.trim();
}

function readStoredConfig(config: Record<string, unknown>): StoredGitHubIssuesConfig {
  const owner = typeof config.owner === 'string' ? config.owner : null;
  const repo = typeof config.repo === 'string' ? config.repo : null;
  const token = typeof config.token === 'string' ? config.token : null;
  if (!owner || !repo || !token) {
    throw new ValidationError('GitHub Issues adapter configuration is incomplete');
  }
  return {
    owner,
    repo,
    token,
    api_base_url: readApiBaseUrl(config.api_base_url, 'https://api.github.com'),
    labels: readLabels(config.labels, []),
  };
}

function readExistingStoredConfig(config: Record<string, unknown>): StoredGitHubIssuesConfig | null {
  try {
    return readStoredConfig(config);
  } catch {
    return null;
  }
}
