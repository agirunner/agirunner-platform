import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
import { createPlaybook } from './support/workflows-records-api.js';

interface ApiRecord {
  id: string;
  name?: string;
}

export interface SeedLoadArgs {
  workflows: number;
  turns: number;
  briefs: number;
  workItems: number;
  tasks: number;
  deliverables: number;
  reset: boolean;
  lifecycle: 'mixed' | 'ongoing' | 'planned';
}

export interface SeedLoadResult {
  seeded_workflows: number;
  workspace_id: string;
  planned_playbook_id: string;
  ongoing_playbook_id: string;
  reset: boolean;
  lifecycle: 'mixed' | 'ongoing' | 'planned';
  turns_per_workflow: number;
  briefs_per_workflow: number;
  work_items_per_workflow: number;
  tasks_per_workflow: number;
  deliverables_per_workflow: number;
}

export async function seedWorkflowLoadCorpus(args: SeedLoadArgs): Promise<SeedLoadResult> {
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
    workItemsPerWorkflow: args.workItems,
    tasksPerWorkflow: args.tasks,
    deliverablesPerWorkflow: args.deliverables,
  });
  runPsql(sql);

  return {
    seeded_workflows: args.workflows,
    workspace_id: workspace.id,
    planned_playbook_id: plannedPlaybook.id,
    ongoing_playbook_id: ongoingPlaybook.id,
    reset: args.reset,
    lifecycle: args.lifecycle,
    turns_per_workflow: args.turns,
    briefs_per_workflow: args.briefs,
    work_items_per_workflow: args.workItems,
    tasks_per_workflow: args.tasks,
    deliverables_per_workflow: args.deliverables,
  };
}

async function main(): Promise<void> {
  const result = await seedWorkflowLoadCorpus(parseSeedLoadArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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

export function parseSeedLoadArgs(argv: string[]): SeedLoadArgs {
  let workflows = 10000;
  let turns = 2;
  let briefs = 1;
  let workItems = 3;
  let tasks = 4;
  let deliverables = 2;
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
      case '--work-items':
        workItems = readPositiveInt(argv[index + 1], workItems);
        index += 1;
        break;
      case '--tasks':
        tasks = readPositiveInt(argv[index + 1], tasks);
        index += 1;
        break;
      case '--deliverables':
        deliverables = readPositiveInt(argv[index + 1], deliverables);
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

  return { workflows, turns, briefs, workItems, tasks, deliverables, reset, lifecycle };
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

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPath).href;
}

if (isMainModule()) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
