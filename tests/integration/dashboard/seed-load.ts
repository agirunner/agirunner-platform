import { spawnSync } from 'node:child_process';

import {
  ADMIN_API_KEY,
  DEFAULT_TENANT_ID,
  PLATFORM_API_URL,
  POSTGRES_CONTAINER_NAME,
  POSTGRES_DB,
  POSTGRES_USER,
} from './support/platform-env.js';
import { resetWorkflowsState } from './support/workflows-fixture-reset.js';
import { buildWorkflowLoadSeedSql } from './support/workflows-load-seed.js';

interface ApiRecord {
  id: string;
  name?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.reset) {
    await resetWorkflowsState();
  }

  const suffix = Date.now().toString(36);
  const workspace = await apiRequest<ApiRecord>('/api/v1/workspaces', {
    method: 'POST',
    body: {
      name: `E2E Workflow Perf Workspace ${suffix}`,
      slug: `workflows-perf-${suffix}`,
      description: 'Seeded large workflow corpus for deterministic performance debugging.',
    },
  });
  const plannedPlaybook = await createPlaybook({
    name: `E2E Workflow Perf Planned ${suffix}`,
    slug: `planned-workflows-perf-${suffix}`,
    lifecycle: 'planned',
  });
  const ongoingPlaybook = await createPlaybook({
    name: `E2E Workflow Perf Ongoing ${suffix}`,
    slug: `ongoing-workflows-perf-${suffix}`,
    lifecycle: 'ongoing',
  });

  const sql = buildWorkflowLoadSeedSql({
    tenantId: DEFAULT_TENANT_ID,
    workspaceId: workspace.id,
    workspaceName: workspace.name ?? `E2E Workflow Perf Workspace ${suffix}`,
    plannedPlaybookId: plannedPlaybook.id,
    plannedPlaybookName: plannedPlaybook.name ?? `E2E Workflow Perf Planned ${suffix}`,
    ongoingPlaybookId: ongoingPlaybook.id,
    ongoingPlaybookName: ongoingPlaybook.name ?? `E2E Workflow Perf Ongoing ${suffix}`,
    count: args.workflows,
    lifecycleMode: args.lifecycle,
    turnsPerWorkflow: args.turns,
    briefsPerWorkflow: args.briefs,
  });
  runPsql(sql);

  process.stdout.write(`${JSON.stringify({
    seeded_workflows: args.workflows,
    workspace_id: workspace.id,
    planned_playbook_id: plannedPlaybook.id,
    ongoing_playbook_id: ongoingPlaybook.id,
    reset: args.reset,
    lifecycle: args.lifecycle,
    turns_per_workflow: args.turns,
    briefs_per_workflow: args.briefs,
  }, null, 2)}\n`);
}

async function createPlaybook(input: {
  name: string;
  slug: string;
  lifecycle: 'planned' | 'ongoing';
}): Promise<ApiRecord> {
  return apiRequest('/api/v1/playbooks', {
    method: 'POST',
    body: {
      name: input.name,
      slug: input.slug,
      description: `Seeded ${input.lifecycle} playbook for workflow perf coverage.`,
      outcome: 'Keep the workflow corpus operator-meaningful under load.',
      lifecycle: input.lifecycle,
      definition: {
        process_instructions: 'Route work, preserve operator visibility, and keep outputs structured.',
        lifecycle: input.lifecycle,
        board: {
          columns: [
            { id: 'planned', label: 'Planned' },
            { id: 'doing', label: 'Doing' },
            { id: 'blocked', label: 'Blocked', is_blocked: true },
            { id: 'done', label: 'Done', is_terminal: true },
          ],
        },
        stages: [
          { name: 'intake', goal: 'Clarify the request' },
          { name: 'delivery', goal: 'Deliver the requested outcome' },
        ],
        parameters: [{ slug: 'workflow_goal', title: 'Workflow Goal', required: true }],
      },
    },
  });
}

async function apiRequest<T>(
  path: string,
  init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<T> {
  const response = await fetch(`${PLATFORM_API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${ADMIN_API_KEY}`,
      'content-type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`API request failed ${init.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { data: T };
  return payload.data;
}

function runPsql(sql: string): void {
  const result = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      POSTGRES_CONTAINER_NAME,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
    ],
    {
      input: sql,
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'psql execution failed').trim());
  }
}

function parseArgs(argv: string[]): {
  workflows: number;
  turns: number;
  briefs: number;
  reset: boolean;
} {
  let workflows = 10000;
  let turns = 2;
  let briefs = 1;
  let reset = true;
  let lifecycle: 'mixed' | 'ongoing' | 'planned' = 'mixed';

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--workflows':
        workflows = readPositiveInt(argv[index + 1], workflows);
        index += 1;
        break;
      case '--turns':
        turns = readPositiveInt(argv[index + 1], turns);
        index += 1;
        break;
      case '--briefs':
        briefs = readPositiveInt(argv[index + 1], briefs);
        index += 1;
        break;
      case '--lifecycle':
        lifecycle = readLifecycle(argv[index + 1], lifecycle);
        index += 1;
        break;
      case '--no-reset':
        reset = false;
        break;
      default:
        break;
    }
  }

  return { workflows, turns, briefs, reset, lifecycle };
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readLifecycle(
  value: string | undefined,
  fallback: 'mixed' | 'ongoing' | 'planned',
): 'mixed' | 'ongoing' | 'planned' {
  return value === 'ongoing' || value === 'planned' || value === 'mixed'
    ? value
    : fallback;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
