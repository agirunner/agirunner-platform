import type { DatabaseQueryable } from '../db/database.js';

const ACTIVE_WORKER_TASK_STATES = ['claimed', 'in_progress'] as const;
const ZERO_TIME_ISO = '0001-01-01T00:00:00Z';

const REPLACE_LIVE_SNAPSHOT_SQL = `
WITH incoming AS (
  SELECT
    BTRIM(entry.container_id) AS container_id,
    BTRIM(entry.name) AS name,
    BTRIM(entry.kind) AS kind,
    BTRIM(entry.state) AS state,
    BTRIM(entry.status) AS status,
    BTRIM(entry.image) AS image,
    NULLIF(BTRIM(entry.cpu_limit), '') AS cpu_limit,
    NULLIF(BTRIM(entry.memory_limit), '') AS memory_limit,
    CASE
      WHEN entry.started_at IS NULL OR BTRIM(entry.started_at) = '' THEN NULL
      ELSE entry.started_at::timestamptz
    END AS started_at,
    entry.desired_state_id,
    NULLIF(BTRIM(entry.runtime_id), '') AS runtime_id,
    entry.task_id,
    entry.workflow_id,
    entry.execution_backend,
    NULLIF(BTRIM(entry.role_name), '') AS role_name,
    NULLIF(BTRIM(entry.playbook_id), '') AS playbook_id,
    NULLIF(BTRIM(entry.playbook_name), '') AS playbook_name
  FROM jsonb_to_recordset($2::jsonb) AS entry(
    container_id text,
    name text,
    kind text,
    state text,
    status text,
    image text,
    cpu_limit text,
    memory_limit text,
    started_at text,
    desired_state_id uuid,
    runtime_id text,
    task_id uuid,
    workflow_id uuid,
    execution_backend execution_backend,
    role_name text,
    playbook_id text,
    playbook_name text
  )
),
pruned AS (
  DELETE FROM live_container_inventory live
   WHERE live.tenant_id = $1
     AND NOT EXISTS (
       SELECT 1
         FROM incoming
        WHERE incoming.container_id = live.container_id
     )
  RETURNING live.container_id
),
upserted AS (
  INSERT INTO live_container_inventory (
    tenant_id,
    container_id,
    name,
    kind,
    state,
    status,
    image,
    cpu_limit,
    memory_limit,
    started_at,
    desired_state_id,
    runtime_id,
    task_id,
    workflow_id,
    execution_backend,
    role_name,
    playbook_id,
    playbook_name,
    last_seen_at
  )
  SELECT
    $1,
    incoming.container_id,
    incoming.name,
    incoming.kind,
    incoming.state,
    incoming.status,
    incoming.image,
    incoming.cpu_limit,
    incoming.memory_limit,
    incoming.started_at,
    incoming.desired_state_id,
    incoming.runtime_id,
    incoming.task_id,
    incoming.workflow_id,
    incoming.execution_backend,
    incoming.role_name,
    incoming.playbook_id,
    incoming.playbook_name,
    now()
  FROM incoming
  ON CONFLICT (tenant_id, container_id) DO UPDATE
  SET
    name = EXCLUDED.name,
    kind = EXCLUDED.kind,
    state = EXCLUDED.state,
    status = EXCLUDED.status,
    image = EXCLUDED.image,
    cpu_limit = EXCLUDED.cpu_limit,
    memory_limit = EXCLUDED.memory_limit,
    started_at = EXCLUDED.started_at,
    desired_state_id = EXCLUDED.desired_state_id,
    runtime_id = EXCLUDED.runtime_id,
    task_id = EXCLUDED.task_id,
    workflow_id = EXCLUDED.workflow_id,
    execution_backend = EXCLUDED.execution_backend,
    role_name = EXCLUDED.role_name,
    playbook_id = EXCLUDED.playbook_id,
    playbook_name = EXCLUDED.playbook_name,
    last_seen_at = EXCLUDED.last_seen_at
  RETURNING container_id
)
SELECT COUNT(*)::int FROM upserted
`;

const LIST_CURRENT_CONTAINERS_SQL = `
WITH active_worker_tasks AS (
  SELECT DISTINCT ON (was.container_id)
         was.container_id,
         t.id AS active_task_id
    FROM worker_actual_state was
    JOIN workers w
      ON w.tenant_id = $1
     AND COALESCE(w.metadata->>'instance_id', '') <> ''
     AND was.container_id LIKE (w.metadata->>'instance_id') || '%'
    JOIN tasks t
      ON t.tenant_id = $1
     AND t.assigned_worker_id = w.id
     AND t.state = ANY($2::task_state[])
   WHERE was.desired_state_id IS NOT NULL
   ORDER BY was.container_id ASC, t.updated_at DESC
),
live_rows AS (
  SELECT
    live.container_id,
    live.name,
    live.kind,
    live.state,
    live.status,
    live.image,
    live.cpu_limit,
    live.memory_limit,
    live.started_at,
    live.last_seen_at,
    live.desired_state_id,
    live.runtime_id,
    live.task_id AS live_task_id,
    live.workflow_id AS live_workflow_id,
    live.execution_backend,
    live.role_name AS live_role_name,
    live.playbook_id AS live_playbook_id,
    live.playbook_name AS live_playbook_name,
    awt.active_task_id,
    rh.task_id AS heartbeat_task_id,
    rh.playbook_id AS heartbeat_playbook_id,
    rh.state AS heartbeat_state
  FROM live_container_inventory live
  LEFT JOIN active_worker_tasks awt
    ON awt.container_id = live.container_id
  LEFT JOIN runtime_heartbeats rh
    ON rh.tenant_id = live.tenant_id
   AND rh.runtime_id::text = live.runtime_id
  WHERE live.tenant_id = $1
)
SELECT
  CASE
    WHEN live.kind = 'orchestrator' THEN 'orchestrator:' || COALESCE(NULLIF(BTRIM(live.name), ''), live.container_id)
    WHEN live.kind = 'runtime' THEN 'runtime:' || COALESCE(NULLIF(BTRIM(live.runtime_id), ''), live.container_id)
    ELSE 'task:' || COALESCE(COALESCE(t.id, live.live_task_id, live.active_task_id, live.heartbeat_task_id)::text, live.container_id)
  END AS id,
  live.kind,
  live.container_id,
  live.name,
  live.state,
  live.status,
  live.image,
  live.cpu_limit,
  live.memory_limit,
  live.started_at,
  live.last_seen_at,
  COALESCE(
    NULLIF(BTRIM(live.live_role_name), ''),
    NULLIF(BTRIM(t.role), ''),
    NULLIF(BTRIM(wd.role), ''),
    CASE WHEN live.kind = 'orchestrator' THEN 'orchestrator' ELSE NULL END
  ) AS role_name,
  p.id::text AS playbook_id,
  COALESCE(p.name, NULLIF(BTRIM(live.live_playbook_name), '')) AS playbook_name,
  COALESCE(w.id, live.live_workflow_id) AS workflow_id,
  w.name AS workflow_name,
  COALESCE(t.id, live.live_task_id, live.active_task_id, live.heartbeat_task_id) AS task_id,
  live.execution_backend,
  t.title AS task_title,
  t.stage_name AS stage_name,
  CASE
    WHEN live.kind = 'runtime' THEN COALESCE(NULLIF(BTRIM(live.heartbeat_state), ''), t.state::text)
    ELSE t.state::text
  END AS activity_state
FROM live_rows live
LEFT JOIN worker_desired_state wd
  ON wd.tenant_id = $1
 AND wd.id = live.desired_state_id
LEFT JOIN tasks t
  ON t.tenant_id = $1
 AND t.id = COALESCE(live.live_task_id, live.active_task_id, live.heartbeat_task_id)
LEFT JOIN workflows w
  ON w.tenant_id = $1
 AND w.id = COALESCE(live.live_workflow_id, t.workflow_id)
LEFT JOIN playbooks p
  ON p.tenant_id = $1
 AND p.id = COALESCE(w.playbook_id, live.heartbeat_playbook_id)
ORDER BY live.kind ASC, live.started_at DESC NULLS LAST, live.last_seen_at DESC, live.name ASC
`;

export interface LiveContainerInventoryInput {
  container_id: string;
  name: string;
  kind: 'orchestrator' | 'runtime' | 'task';
  state: string;
  status: string;
  image: string;
  cpu_limit?: string | null;
  memory_limit?: string | null;
  started_at?: string | null;
  desired_state_id?: string | null;
  runtime_id?: string | null;
  task_id?: string | null;
  workflow_id?: string | null;
  execution_backend?: 'runtime_only' | 'runtime_plus_task' | null;
  role_name?: string | null;
  playbook_id?: string | null;
  playbook_name?: string | null;
}

export interface LiveContainerInventoryRow {
  [key: string]: unknown;
  id: string;
  kind: string;
  container_id: string;
  name: string;
  state: string;
  status: string;
  image: string;
  cpu_limit: string | null;
  memory_limit: string | null;
  started_at: Date | null;
  last_seen_at: Date;
  role_name: string | null;
  playbook_id: string | null;
  playbook_name: string | null;
  workflow_id: string | null;
  workflow_name: string | null;
  task_id: string | null;
  execution_backend: 'runtime_only' | 'runtime_plus_task' | null;
  task_title: string | null;
  stage_name: string | null;
  activity_state: string | null;
}

export class ContainerInventoryService {
  constructor(private readonly pool: DatabaseQueryable) {}

  async replaceLiveSnapshot(tenantId: string, snapshot: LiveContainerInventoryInput[]): Promise<void> {
    const normalizedSnapshot = normalizeLiveSnapshot(snapshot);
    await this.pool.query(REPLACE_LIVE_SNAPSHOT_SQL, [tenantId, JSON.stringify(normalizedSnapshot)]);
  }

  async listCurrentContainers(tenantId: string): Promise<LiveContainerInventoryRow[]> {
    const result = await this.pool.query<LiveContainerInventoryRow>(LIST_CURRENT_CONTAINERS_SQL, [
      tenantId,
      [...ACTIVE_WORKER_TASK_STATES],
    ]);
    return result.rows;
  }
}

function normalizeLiveContainerInput(input: LiveContainerInventoryInput): LiveContainerInventoryInput {
  return {
    ...input,
    container_id: input.container_id.trim(),
    name: input.name.trim(),
    state: input.state.trim(),
    status: input.status.trim(),
    image: input.image.trim(),
    cpu_limit: normalizeOptionalText(input.cpu_limit),
    memory_limit: normalizeOptionalText(input.memory_limit),
    started_at: normalizeStartedAt(input.started_at),
    desired_state_id: normalizeOptionalText(input.desired_state_id),
    runtime_id: normalizeOptionalText(input.runtime_id),
    task_id: normalizeOptionalText(input.task_id),
    workflow_id: normalizeOptionalText(input.workflow_id),
    role_name: normalizeOptionalText(input.role_name),
    playbook_id: normalizeOptionalText(input.playbook_id),
    playbook_name: normalizeOptionalText(input.playbook_name),
  };
}

function normalizeLiveSnapshot(snapshot: LiveContainerInventoryInput[]): LiveContainerInventoryInput[] {
  const dedupedSnapshot = new Map<string, LiveContainerInventoryInput>();
  for (const rawInput of snapshot) {
    const normalizedInput = normalizeLiveContainerInput(rawInput);
    dedupedSnapshot.set(normalizedInput.container_id, normalizedInput);
  }
  return [...dedupedSnapshot.values()];
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStartedAt(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized || normalized === ZERO_TIME_ISO) {
    return null;
  }
  return normalized;
}
