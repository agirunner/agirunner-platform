import type { DatabaseQueryable } from '../db/database.js';
import {
  currentStageNameFromStages,
  isActiveStageStatus,
  queryWorkflowStageViews,
  type WorkflowStageResponse,
} from './workflow-stage-service.js';

interface WorkflowStageProjectionInput {
  lifecycle: 'ongoing' | 'planned';
  stageRows: Array<Pick<WorkflowStageResponse, 'name' | 'position' | 'status'>>;
  openWorkItemStageNames: string[];
  definition?: unknown;
}

interface LoadWorkflowStageProjectionInput {
  lifecycle: 'ongoing' | 'planned';
  definition?: unknown;
}

export interface WorkflowStageProjection {
  currentStage: string | null;
  activeStages: string[];
}

export async function loadWorkflowStageProjection(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
  input: LoadWorkflowStageProjectionInput,
): Promise<WorkflowStageProjection & { stageRows: WorkflowStageResponse[] }> {
  const openWorkItemStageNames = await loadOpenWorkflowWorkItemStageNames(db, tenantId, workflowId);

  if (input.lifecycle === 'ongoing') {
    return {
      stageRows: [],
      ...deriveWorkflowStageProjection({
        lifecycle: input.lifecycle,
        stageRows: [],
        openWorkItemStageNames,
        definition: input.definition,
      }),
    };
  }

  const stageRows = await queryWorkflowStageViews(db, tenantId, workflowId);
  return {
    stageRows,
    ...deriveWorkflowStageProjection({
      lifecycle: input.lifecycle,
      stageRows,
      openWorkItemStageNames,
      definition: input.definition,
    }),
  };
}

export function deriveWorkflowStageProjection(
  input: WorkflowStageProjectionInput,
): WorkflowStageProjection {
  if (input.lifecycle === 'ongoing') {
    return {
      currentStage: null,
      activeStages: orderStageNames(
        input.openWorkItemStageNames,
        input.stageRows,
        input.definition,
      ),
    };
  }

  const orderedOpenStages = orderStageNames(
    input.openWorkItemStageNames,
    input.stageRows,
    input.definition,
  );
  if (orderedOpenStages.length > 0) {
    return {
      currentStage: orderedOpenStages[0] ?? null,
      activeStages: mergeStageNames(
        orderedOpenStages,
        input.stageRows
          .filter((row) => row.status === 'awaiting_gate' || row.status === 'blocked')
          .map((row) => row.name),
      ),
    };
  }

  return {
    currentStage: currentStageNameFromStages(input.stageRows),
    activeStages: input.stageRows
      .filter((row) => isActiveStageStatus(row.status))
      .map((row) => row.name),
  };
}

export async function loadOpenWorkflowWorkItemStageNames(
  db: DatabaseQueryable,
  tenantId: string,
  workflowId: string,
) {
  const result = await db.query<{ stage_name: string }>(
    `SELECT DISTINCT wi.stage_name
       FROM workflow_work_items wi
      WHERE wi.tenant_id = $1
        AND wi.workflow_id = $2
        AND wi.completed_at IS NULL
        AND wi.stage_name IS NOT NULL
      ORDER BY wi.stage_name ASC`,
    [tenantId, workflowId],
  );
  return result.rows.map((row) => row.stage_name);
}

function mergeStageNames(primary: string[], additional: string[]) {
  return Array.from(new Set([...primary, ...additional]));
}

function orderStageNames(
  stageNames: string[],
  stageRows: Array<Pick<WorkflowStageResponse, 'name' | 'position'>>,
  definition: unknown,
) {
  if (stageNames.length <= 1) {
    return stageNames;
  }

  const stageOrder = readStageOrder(stageRows, definition);
  if (stageOrder.length === 0) {
    return stageNames;
  }

  const remaining = new Set(stageNames);
  const ordered: string[] = [];
  for (const stageName of stageOrder) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  for (const stageName of stageNames) {
    if (!remaining.has(stageName)) {
      continue;
    }
    ordered.push(stageName);
    remaining.delete(stageName);
  }
  return ordered;
}

function readStageOrder(
  stageRows: Array<Pick<WorkflowStageResponse, 'name' | 'position'>>,
  definition: unknown,
) {
  if (stageRows.length > 0) {
    return stageRows
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((row) => row.name);
  }

  const stages = readDefinitionStages(definition);
  if (stages.length === 0) {
    return [];
  }
  return stages;
}

function readDefinitionStages(definition: unknown) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return [];
  }
  const stages = (definition as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) {
    return [];
  }
  return stages
    .map((stage) => {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) {
        return null;
      }
      const name = (stage as { name?: unknown }).name;
      return typeof name === 'string' && name.length > 0 ? name : null;
    })
    .filter((name): name is string => name !== null);
}
