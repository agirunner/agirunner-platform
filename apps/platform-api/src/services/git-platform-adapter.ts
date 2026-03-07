interface InboundGitWebhookIdentity {
  provider: 'github' | 'gitea' | 'gitlab';
  eventType: string;
}

interface NormalizedGitEvent {
  linked_prs?: Array<Record<string, unknown>>;
  branches?: string[];
  ci_status?: Record<string, unknown>;
  merge_history?: Array<Record<string, unknown>>;
  provider_event: Record<string, unknown>;
}

export function extractTaskIdFromGitPayload(payload: Record<string, unknown>): string | undefined {
  const texts: string[] = [];

  const pullRequest = asRecord(payload.pull_request);
  const gitlabAttrs = asRecord(payload.object_attributes);
  const commit = asRecord(payload.head_commit);
  const checkRun = asRecord(payload.check_run);

  [
    payload['title'],
    payload['body'],
    payload['ref'],
    pullRequest['title'],
    pullRequest['body'],
    pullRequest['head'] && asRecord(pullRequest['head'])['ref'],
    pullRequest['base'] && asRecord(pullRequest['base'])['ref'],
    gitlabAttrs['title'],
    gitlabAttrs['description'],
    gitlabAttrs['source_branch'],
    gitlabAttrs['target_branch'],
    commit['message'],
    checkRun['name'],
  ].forEach((value) => {
    if (typeof value === 'string' && value.length > 0) {
      texts.push(value);
    }
  });

  const taskIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

  for (const text of texts) {
    const match = text.match(taskIdPattern);
    if (match) {
      return match[0].toLowerCase();
    }
  }

  return undefined;
}

export function mapGitEventType(
  identity: InboundGitWebhookIdentity,
  payload: Record<string, unknown>,
): string {
  if (identity.eventType === 'pull_request' || identity.eventType === 'merge_request') {
    const action = String(
      payload.action ?? asRecord(payload.object_attributes).action ?? 'updated',
    );
    if (action === 'opened' || action === 'open') return 'task.git.pr_opened';
    if ((action === 'closed' || action === 'close') && isMergedPullRequest(identity, payload)) {
      return 'task.git.pr_merged';
    }
    if (action === 'closed' || action === 'close') return 'task.git.pr_closed';
    return 'task.git.pr_updated';
  }

  if (
    identity.eventType === 'status' ||
    identity.eventType === 'check_run' ||
    identity.eventType === 'workflow'
  ) {
    return 'task.git.ci_status_updated';
  }

  return `task.git.${identity.eventType}`;
}

export function normalizeGitEvent(
  identity: InboundGitWebhookIdentity,
  payload: Record<string, unknown>,
): NormalizedGitEvent {
  const normalized: NormalizedGitEvent = {
    provider_event: {
      provider: identity.provider,
      event_type: identity.eventType,
      action: payload.action ?? asRecord(payload.object_attributes).action ?? null,
      received_at: new Date().toISOString(),
    },
  };

  const pr = normalizePullRequest(identity, payload);
  if (pr) {
    normalized.linked_prs = [pr];
    normalized.branches = compactStrings([
      pr.source_branch as string | undefined,
      pr.target_branch as string | undefined,
    ]);
    if (isMergedPullRequest(identity, payload)) {
      normalized.merge_history = [
        {
          provider: identity.provider,
          merged_at:
            pr.merged_at ??
            asRecord(payload.object_attributes).updated_at ??
            asRecord(payload.pull_request).merged_at ??
            null,
          merge_commit_sha:
            pr.merge_commit_sha ??
            asRecord(payload.object_attributes).merge_commit_sha ??
            asRecord(payload.pull_request).merge_commit_sha ??
            null,
          url: pr.url ?? null,
        },
      ];
    }
  }

  const ciStatus = normalizeCiStatus(identity, payload);
  if (ciStatus) {
    normalized.ci_status = ciStatus;
  }

  return normalized;
}

function normalizePullRequest(
  identity: InboundGitWebhookIdentity,
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (identity.provider === 'gitlab') {
    const attrs = asRecord(payload.object_attributes);
    if (!attrs.iid && !attrs.id) {
      return undefined;
    }
    return compactRecord({
      provider: 'gitlab',
      id: attrs.iid ?? attrs.id,
      title: attrs.title,
      description: attrs.description,
      url: attrs.url,
      state: attrs.state,
      source_branch: attrs.source_branch,
      target_branch: attrs.target_branch,
      merge_status: attrs.merge_status,
      merge_commit_sha: attrs.merge_commit_sha,
      merged_at: attrs.updated_at,
    });
  }

  const pullRequest = asRecord(payload.pull_request);
  if (!pullRequest.number && !pullRequest.id) {
    return undefined;
  }

  const head = asRecord(pullRequest.head);
  const base = asRecord(pullRequest.base);
  return compactRecord({
    provider: identity.provider,
    id: pullRequest.number ?? pullRequest.id,
    title: pullRequest.title,
    description: pullRequest.body,
    url: pullRequest.html_url ?? pullRequest.url,
    state: pullRequest.state,
    source_branch: head.ref,
    target_branch: base.ref,
    merge_commit_sha: pullRequest.merge_commit_sha,
    merged_at: pullRequest.merged_at,
  });
}

function normalizeCiStatus(
  identity: InboundGitWebhookIdentity,
  payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (identity.provider === 'gitlab') {
    const attrs = asRecord(payload.object_attributes);
    if (!attrs.status && !attrs.id) {
      return undefined;
    }
    return compactRecord({
      provider: 'gitlab',
      state: attrs.status,
      workflow_id: attrs.id,
      sha: attrs.sha,
      ref: attrs.ref,
      web_url: attrs.url,
    });
  }

  if (identity.eventType === 'check_run') {
    const checkRun = asRecord(payload.check_run);
    return compactRecord({
      provider: identity.provider,
      state: checkRun.conclusion ?? checkRun.status,
      sha: checkRun.head_sha,
      url: checkRun.html_url ?? checkRun.url,
      name: checkRun.name,
    });
  }

  const state = payload.state;
  if (typeof state !== 'string' || state.length === 0) {
    return undefined;
  }
  return compactRecord({
    provider: identity.provider,
    state,
    sha: payload.sha,
    url: payload.target_url,
    description: payload.description,
  });
}

function isMergedPullRequest(
  identity: InboundGitWebhookIdentity,
  payload: Record<string, unknown>,
): boolean {
  if (identity.provider === 'gitlab') {
    return String(asRecord(payload.object_attributes).state ?? '').toLowerCase() === 'merged';
  }
  return asRecord(payload.pull_request).merged === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function compactStrings(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  );
}
