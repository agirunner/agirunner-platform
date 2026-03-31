import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { NotFoundError } from '../errors/domain-errors.js';
import { EventService } from './event-service.js';
import { WorkflowActivationDispatchService } from './workflow-activation-dispatch-service.js';
import { WorkflowActivationService } from './workflow-activation/workflow-activation-service.js';
import type { WorkflowBudgetSnapshot } from './workflow-service.types.js';

type BudgetDimension = 'tokens' | 'cost' | 'duration';

interface WorkflowBudgetConfig {
  WORKFLOW_BUDGET_WARNING_RATIO?: number;
}

interface WorkflowBudgetRow {
  id: string;
  token_budget: number | null;
  cost_cap_usd: string | number | null;
  max_duration_minutes: number | null;
  created_at: Date;
  started_at: Date | null;
  orchestration_state: Record<string, unknown> | null;
}

interface WorkflowBudgetEvaluation {
  snapshot: WorkflowBudgetSnapshot;
  newWarningDimensions: BudgetDimension[];
  newExceededDimensions: BudgetDimension[];
}

interface BudgetUsage {
  tokens_used: number;
  cost_usd: number;
  elapsed_minutes: number;
}

interface BudgetLimits {
  tokens_limit: number | null;
  cost_limit_usd: number | null;
  duration_limit_minutes: number | null;
}

interface BudgetPolicyState {
  warning_dimensions: BudgetDimension[];
  exceeded_dimensions: BudgetDimension[];
}

const DEFAULT_WARNING_RATIO = 0.8;
const CURRENCY_PRECISION = 4;
const DURATION_PRECISION = 2;

export class WorkflowBudgetService {
  private readonly warningRatio: number;

  constructor(
    private readonly pool: DatabasePool,
    private readonly eventService: EventService,
    config: WorkflowBudgetConfig,
    private readonly activationService?: WorkflowActivationService,
    private readonly activationDispatchService?: WorkflowActivationDispatchService,
  ) {
    this.warningRatio = config.WORKFLOW_BUDGET_WARNING_RATIO ?? DEFAULT_WARNING_RATIO;
  }

  async getBudgetSnapshot(
    tenantId: string,
    workflowId: string,
    client?: DatabaseClient,
  ): Promise<WorkflowBudgetSnapshot> {
    const db = client ?? this.pool;
    const workflow = await loadWorkflowBudgetRow(db, tenantId, workflowId);
    return buildWorkflowBudgetSnapshot(db, tenantId, workflow, this.warningRatio);
  }

  async evaluatePolicy(
    tenantId: string,
    workflowId: string,
    client?: DatabaseClient,
  ): Promise<WorkflowBudgetEvaluation> {
    const db = client ?? (await this.pool.connect());
    const ownsClient = client === undefined;

    try {
      if (ownsClient) {
        await db.query('BEGIN');
      }

      const workflow = await loadWorkflowBudgetRowForUpdate(db, tenantId, workflowId);
      const snapshot = await buildWorkflowBudgetSnapshot(db, tenantId, workflow, this.warningRatio);
      const previous = readPolicyState(workflow.orchestration_state);
      const current = readPolicyState({ budget_policy: snapshot });
      const evaluation = {
        snapshot,
        newWarningDimensions: difference(
          current.warning_dimensions,
          mergeDimensions(previous.warning_dimensions, previous.exceeded_dimensions),
        ),
        newExceededDimensions: difference(
          current.exceeded_dimensions,
          previous.exceeded_dimensions,
        ),
      };

      await persistPolicyState(
        db,
        tenantId,
        workflowId,
        workflow.orchestration_state,
        current,
        this.warningRatio,
      );
      await emitBudgetEvents(db, this.eventService, tenantId, workflowId, evaluation);
      await enqueueExceededActivation(
        db,
        tenantId,
        workflowId,
        evaluation,
        this.activationService,
        this.activationDispatchService,
      );

      if (ownsClient) {
        await db.query('COMMIT');
      }
      return evaluation;
    } catch (error) {
      if (ownsClient) {
        await db.query('ROLLBACK');
      }
      throw error;
    } finally {
      if (ownsClient) {
        db.release();
      }
    }
  }
}

async function loadWorkflowBudgetRow(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowBudgetRow> {
  const result = await db.query<WorkflowBudgetRow>(
    `SELECT id, token_budget, cost_cap_usd, max_duration_minutes, created_at, started_at, orchestration_state
       FROM workflows
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workflowId],
  );
  const workflow = result.rows[0];
  if (!workflow) {
    throw new NotFoundError('Workflow not found');
  }
  return workflow;
}

async function loadWorkflowBudgetRowForUpdate(
  db: DatabaseClient,
  tenantId: string,
  workflowId: string,
): Promise<WorkflowBudgetRow> {
  const result = await db.query<WorkflowBudgetRow>(
    `SELECT id, token_budget, cost_cap_usd, max_duration_minutes, created_at, started_at, orchestration_state
       FROM workflows
      WHERE tenant_id = $1
        AND id = $2
      FOR UPDATE`,
    [tenantId, workflowId],
  );
  const workflow = result.rows[0];
  if (!workflow) {
    throw new NotFoundError('Workflow not found');
  }
  return workflow;
}

async function buildWorkflowBudgetSnapshot(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflow: WorkflowBudgetRow,
  warningRatio: number,
): Promise<WorkflowBudgetSnapshot> {
  const [usage, taskCount, activationCount] = await Promise.all([
    readBudgetUsage(db, tenantId, workflow),
    countWorkflowTasks(db, tenantId, workflow.id),
    countWorkflowActivations(db, tenantId, workflow.id),
  ]);
  const limits = readBudgetLimits(workflow);
  return {
    tokens_used: usage.tokens_used,
    tokens_limit: limits.tokens_limit,
    cost_usd: usage.cost_usd,
    cost_limit_usd: limits.cost_limit_usd,
    elapsed_minutes: usage.elapsed_minutes,
    duration_limit_minutes: limits.duration_limit_minutes,
    task_count: taskCount,
    orchestrator_activations: activationCount,
    tokens_remaining: remaining(limits.tokens_limit, usage.tokens_used, 0),
    cost_remaining_usd: remaining(limits.cost_limit_usd, usage.cost_usd, CURRENCY_PRECISION),
    time_remaining_minutes: remaining(limits.duration_limit_minutes, usage.elapsed_minutes, DURATION_PRECISION),
    warning_dimensions: resolveWarningDimensions(usage, limits, warningRatio),
    exceeded_dimensions: resolveExceededDimensions(usage, limits),
    warning_threshold_ratio: warningRatio,
  };
}

async function readBudgetUsage(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflow: WorkflowBudgetRow,
): Promise<BudgetUsage> {
  const result = await db.query<{
    total_tokens_input: string;
    total_tokens_output: string;
    total_cost_usd: string;
  }>(
    `SELECT
        COALESCE(SUM(tokens_input), 0) AS total_tokens_input,
        COALESCE(SUM(tokens_output), 0) AS total_tokens_output,
        COALESCE(SUM(cost_usd), 0) AS total_cost_usd
       FROM metering_events
      WHERE tenant_id = $1
        AND workflow_id = $2`,
    [tenantId, workflow.id],
  );
  const row = result.rows[0];
  return {
    tokens_used: Number(row?.total_tokens_input ?? '0') + Number(row?.total_tokens_output ?? '0'),
    cost_usd: round(Number(row?.total_cost_usd ?? '0'), CURRENCY_PRECISION),
    elapsed_minutes: round(
      (Date.now() - (workflow.started_at ?? workflow.created_at).getTime()) / 60_000,
      DURATION_PRECISION,
    ),
  };
}

function readBudgetLimits(workflow: WorkflowBudgetRow): BudgetLimits {
  return {
    tokens_limit: typeof workflow.token_budget === 'number' ? workflow.token_budget : null,
    cost_limit_usd: normalizeNumeric(workflow.cost_cap_usd),
    duration_limit_minutes:
      typeof workflow.max_duration_minutes === 'number' ? workflow.max_duration_minutes : null,
  };
}

async function countWorkflowTasks(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflowId: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM tasks
      WHERE tenant_id = $1
        AND workflow_id = $2`,
    [tenantId, workflowId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function countWorkflowActivations(
  db: DatabaseClient | DatabasePool,
  tenantId: string,
  workflowId: string,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT COALESCE(activation_id, id))::text AS count
       FROM workflow_activations
      WHERE tenant_id = $1
        AND workflow_id = $2`,
    [tenantId, workflowId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

async function persistPolicyState(
  db: DatabaseClient,
  tenantId: string,
  workflowId: string,
  orchestrationState: Record<string, unknown> | null,
  state: BudgetPolicyState,
  warningRatio: number,
): Promise<void> {
  const nextState = {
    ...asRecord(orchestrationState),
    budget_policy: {
      warning_dimensions: state.warning_dimensions,
      exceeded_dimensions: state.exceeded_dimensions,
      warning_threshold_ratio: warningRatio,
      evaluated_at: new Date().toISOString(),
    },
  };
  await db.query(
    `UPDATE workflows
        SET orchestration_state = $3::jsonb,
            updated_at = now()
      WHERE tenant_id = $1
        AND id = $2`,
    [tenantId, workflowId, nextState],
  );
}

async function emitBudgetEvents(
  db: DatabaseClient,
  eventService: EventService,
  tenantId: string,
  workflowId: string,
  evaluation: WorkflowBudgetEvaluation,
): Promise<void> {
  if (evaluation.newWarningDimensions.length > 0) {
    await eventService.emit(
      {
        tenantId,
        type: 'budget.warning',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: 'system',
        actorId: 'workflow_budget_policy',
        data: buildBudgetEventData(evaluation.snapshot, evaluation.newWarningDimensions),
      },
      db,
    );
  }
  if (evaluation.newExceededDimensions.length > 0) {
    await eventService.emit(
      {
        tenantId,
        type: 'budget.exceeded',
        entityType: 'workflow',
        entityId: workflowId,
        actorType: 'system',
        actorId: 'workflow_budget_policy',
        data: buildBudgetEventData(evaluation.snapshot, evaluation.newExceededDimensions),
      },
      db,
    );
  }
}

async function enqueueExceededActivation(
  db: DatabaseClient,
  tenantId: string,
  workflowId: string,
  evaluation: WorkflowBudgetEvaluation,
  activationService?: WorkflowActivationService,
  activationDispatchService?: WorkflowActivationDispatchService,
): Promise<void> {
  if (
    evaluation.newExceededDimensions.length === 0 ||
    !activationService ||
    !activationDispatchService
  ) {
    return;
  }
  const activation = await activationService.enqueueForWorkflow(
    {
      tenantId,
      workflowId,
      requestId: `budget.exceeded:${evaluation.newExceededDimensions.join('+')}`,
      reason: 'budget.exceeded',
      eventType: 'budget.exceeded',
      payload: buildBudgetEventData(evaluation.snapshot, evaluation.newExceededDimensions),
      actorType: 'system',
      actorId: 'workflow_budget_policy',
    },
    db,
  );
  await activationDispatchService.dispatchActivation(tenantId, String(activation.id), db, {
    ignoreDelay: true,
  });
}

function buildBudgetEventData(
  snapshot: WorkflowBudgetSnapshot,
  dimensions: BudgetDimension[],
): Record<string, unknown> {
  return {
    dimensions,
    tokens_used: snapshot.tokens_used,
    tokens_limit: snapshot.tokens_limit,
    cost_usd: snapshot.cost_usd,
    cost_limit_usd: snapshot.cost_limit_usd,
    elapsed_minutes: snapshot.elapsed_minutes,
    duration_limit_minutes: snapshot.duration_limit_minutes,
    tokens_remaining: snapshot.tokens_remaining,
    cost_remaining_usd: snapshot.cost_remaining_usd,
    time_remaining_minutes: snapshot.time_remaining_minutes,
  };
}

function resolveWarningDimensions(
  usage: BudgetUsage,
  limits: BudgetLimits,
  warningRatio: number,
): BudgetDimension[] {
  return budgetDimensions.filter((dimension) => {
    const limit = readLimit(dimension, limits);
    return limit !== null && limit > 0 && readUsage(dimension, usage) >= limit * warningRatio && readUsage(dimension, usage) < limit;
  });
}

function resolveExceededDimensions(usage: BudgetUsage, limits: BudgetLimits): BudgetDimension[] {
  return budgetDimensions.filter((dimension) => {
    const limit = readLimit(dimension, limits);
    return limit !== null && limit > 0 && readUsage(dimension, usage) >= limit;
  });
}

const budgetDimensions: BudgetDimension[] = ['tokens', 'cost', 'duration'];

function readUsage(dimension: BudgetDimension, usage: BudgetUsage): number {
  if (dimension === 'tokens') return usage.tokens_used;
  if (dimension === 'cost') return usage.cost_usd;
  return usage.elapsed_minutes;
}

function readLimit(dimension: BudgetDimension, limits: BudgetLimits): number | null {
  if (dimension === 'tokens') return limits.tokens_limit;
  if (dimension === 'cost') return limits.cost_limit_usd;
  return limits.duration_limit_minutes;
}

function readPolicyState(orchestrationState: Record<string, unknown> | null): BudgetPolicyState {
  const policy = asRecord(asRecord(orchestrationState).budget_policy);
  return {
    warning_dimensions: readDimensions(policy.warning_dimensions),
    exceeded_dimensions: readDimensions(policy.exceeded_dimensions),
  };
}

function readDimensions(value: unknown): BudgetDimension[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is BudgetDimension =>
    entry === 'tokens' || entry === 'cost' || entry === 'duration',
  );
}

function difference(current: BudgetDimension[], previous: BudgetDimension[]): BudgetDimension[] {
  const prior = new Set(previous);
  return current.filter((dimension) => !prior.has(dimension));
}

function mergeDimensions(left: BudgetDimension[], right: BudgetDimension[]): BudgetDimension[] {
  return [...new Set([...left, ...right])];
}

function remaining(limit: number | null, used: number, precision: number): number | null {
  if (limit === null) {
    return null;
  }
  return round(Math.max(limit - used, 0), precision);
}

function normalizeNumeric(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return round(value, CURRENCY_PRECISION);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? round(parsed, CURRENCY_PRECISION) : null;
  }
  return null;
}

function round(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
