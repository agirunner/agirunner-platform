import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import type { ApiKeyIdentity } from '../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../db/database.js';
import { AgentBusyError, ForbiddenError, NotFoundError, ValidationError } from '../errors/domain-errors.js';
import {
  isExternalSecretReference,
  readOAuthToken,
  readProviderSecret,
} from '../lib/oauth-crypto.js';
import { assertValidTransition, type TaskState } from '../orchestration/task-state-machine.js';
import { EventService } from './event-service.js';
import type { ResolvedRoleConfig } from './model-catalog-service.js';
import { OAuthService } from './oauth-service.js';
import { PlaybookTaskParallelismService } from './playbook-task-parallelism-service.js';
import { flattenInstructionLayers } from './task-context-service.js';
import { computeToolMatch, readAgentToolRequirements, resolveProjectToolTags } from './tool-tag-service.js';

const priorityCase = "CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END";

type AgentExecutionMode = 'specialist' | 'orchestrator' | 'hybrid';
const claimRoleConfigSecretKeys = new Set([
  'llm_api_key',
  'llm_api_key_secret_ref',
  'llm_extra_headers',
  'llm_extra_headers_secret_ref',
  'api_key',
  'access_token',
  'token',
  'authorization',
]);
const CLAIM_CREDENTIAL_HANDLE_VERSION = 'v1';
const CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES = 12;
type ClaimCredentialKind = 'llm_api_key' | 'llm_extra_headers';
interface ClaimCredentialPayload {
  task_id?: string;
  kind?: string;
  stored_secret?: string;
}

interface TaskClaimDependencies {
  pool: DatabasePool;
  eventService: EventService;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  getTaskContext: (tenantId: string, taskId: string, agentId?: string) => Promise<unknown>;
  resolveRoleConfig?: (tenantId: string, roleName: string) => Promise<ResolvedRoleConfig | null>;
  parallelismService?: PlaybookTaskParallelismService;
  claimHandleSecret: string;
}

interface DirectModelLookupRow {
  provider_id: string;
  provider_name: string;
  provider_base_url: string | null;
  provider_api_key_secret_ref: string | null;
  provider_auth_mode: string | null;
  provider_metadata: Record<string, unknown> | null;
  model_id: string;
  model_context_window: number | null;
  model_endpoint_type: string | null;
  model_reasoning_config: Record<string, unknown> | null;
}

interface RetryReadyTaskRow {
  id: string;
  workflow_id: string | null;
  work_item_id: string | null;
  is_orchestrator_task: boolean;
  state: TaskState;
}

export class TaskClaimService {
  constructor(private readonly deps: TaskClaimDependencies) {}

  async claimTask(
    identity: ApiKeyIdentity,
    payload: {
      agent_id: string;
      worker_id?: string;
      capabilities: string[];
      workflow_id?: string;
      playbook_id?: string;
      include_context?: boolean;
    },
  ): Promise<Record<string, unknown> | null> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      await this.promoteRetryReadyTasks(identity.tenantId, payload.workflow_id, client);

      const agentRes = await client.query('SELECT * FROM agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [
        identity.tenantId,
        payload.agent_id,
      ]);
      if (!agentRes.rowCount) throw new NotFoundError('Agent not found');

      const agent = agentRes.rows[0];
      const executionMode = readAgentExecutionMode(agent.metadata);
      if (identity.scope === 'worker') {
        if (!identity.ownerId) {
          throw new ForbiddenError('Worker identity is not bound to a worker owner.');
        }

        if (agent.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Worker cannot claim tasks with an agent owned by a different worker.');
        }

        if (payload.worker_id && payload.worker_id !== identity.ownerId) {
          throw new ForbiddenError('Worker cannot claim tasks on behalf of a different worker.');
        }
      }

      if (payload.worker_id && agent.worker_id !== payload.worker_id) {
        throw new ForbiddenError('Worker cannot claim tasks with an agent owned by a different worker.');
      }

      if (agent.current_task_id) {
        throw new AgentBusyError(`Agent already holds task '${agent.current_task_id}'. Complete or fail it first.`, {
          current_task_id: agent.current_task_id,
        });
      }

      const taskRes = await client.query(
        `SELECT tasks.* FROM tasks
         LEFT JOIN workflows ON workflows.tenant_id = tasks.tenant_id AND workflows.id = tasks.workflow_id
         WHERE tasks.tenant_id = $1
           AND tasks.state = 'ready'
           AND tasks.capabilities_required <@ $2::text[]
           AND ($3::uuid IS NULL OR tasks.workflow_id = $3::uuid)
           AND ($6::uuid IS NULL OR workflows.playbook_id = $6::uuid)
           AND ${buildExecutionModeCondition(executionMode)}
           AND (workflows.id IS NULL OR workflows.state <> 'paused')
           AND (
             NOT (tasks.metadata ? 'preferred_agent_id')
             OR NULLIF(tasks.metadata->>'preferred_agent_id', '') IS NULL
             OR tasks.metadata->>'preferred_agent_id' = $4
           )
           AND (
             NOT (tasks.metadata ? 'preferred_worker_id')
             OR NULLIF(tasks.metadata->>'preferred_worker_id', '') IS NULL
             OR tasks.metadata->>'preferred_worker_id' = COALESCE($5, tasks.metadata->>'preferred_worker_id')
           )
         ORDER BY
           CASE WHEN tasks.metadata->>'preferred_agent_id' = $4 THEN 1 ELSE 0 END DESC,
           CASE WHEN tasks.metadata->>'preferred_worker_id' = COALESCE($5, tasks.metadata->>'preferred_worker_id') THEN 1 ELSE 0 END DESC,
           ${priorityCase} DESC,
           tasks.created_at ASC
         LIMIT 25
         FOR UPDATE OF tasks SKIP LOCKED`,
        [identity.tenantId, payload.capabilities, payload.workflow_id ?? null, payload.agent_id, payload.worker_id ?? null, payload.playbook_id ?? null],
      );

      if (!taskRes.rowCount) {
        await client.query('COMMIT');
        return null;
      }

      const agentTools = readAgentToolRequirements(agent);
      let task: Record<string, unknown> | null = null;
      let toolMatch = { matched: [] as string[], unavailable_optional: [] as string[] };
      for (const candidate of taskRes.rows as Record<string, unknown>[]) {
        if (
          this.deps.parallelismService &&
          (await this.deps.parallelismService.shouldQueueForCapacity(
            identity.tenantId,
            {
              taskId: String(candidate.id),
              workflowId:
                typeof candidate.workflow_id === 'string' ? candidate.workflow_id : null,
              workItemId:
                typeof candidate.work_item_id === 'string' ? candidate.work_item_id : null,
              isOrchestratorTask: candidate.is_orchestrator_task === true,
              currentState: candidate.state as TaskState,
            },
            client,
          ))
        ) {
          continue;
        }
        const projectTools = await resolveProjectToolTags(
          client,
          identity.tenantId,
          (candidate.project_id as string | null | undefined) ?? null,
        );
        const evaluation = computeToolMatch(projectTools, agentTools);
        if (evaluation.matches) {
          task = candidate;
          toolMatch = {
            matched: evaluation.matched,
            unavailable_optional: evaluation.unavailable_optional,
          };
          break;
        }
      }

      if (!task) {
        await client.query('COMMIT');
        return null;
      }
      assertValidTransition(task.id as string, task.state as Parameters<typeof assertValidTransition>[1], 'claimed');

      const updatedTaskRes = await client.query(
        `UPDATE tasks
         SET state = 'claimed', state_changed_at = now(),
             assigned_agent_id = $3, assigned_worker_id = $4, claimed_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [identity.tenantId, task.id, payload.agent_id, payload.worker_id ?? null],
      );

      await client.query(
        `UPDATE agents SET current_task_id = $2, status = 'busy', last_heartbeat_at = now()
         WHERE tenant_id = $1 AND id = $3`,
        [identity.tenantId, task.id, payload.agent_id],
      );

      await this.deps.eventService.emit(
        {
          tenantId: identity.tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: task.id as string,
          actorType: identity.scope,
          actorId: identity.keyPrefix,
          data: {
            from_state: 'ready',
            to_state: 'claimed',
            agent_id: payload.agent_id,
            worker_id: payload.worker_id ?? null,
          },
        },
        client,
      );

      await client.query('COMMIT');
      const claimedTask = this.deps.toTaskResponse(updatedTaskRes.rows[0] as Record<string, unknown>);

      const namesRes = await client.query(
        `SELECT
           w.name AS workflow_name,
           p.name AS project_name
         FROM tasks t
         LEFT JOIN workflows w ON w.tenant_id = t.tenant_id AND w.id = t.workflow_id
         LEFT JOIN projects p ON p.tenant_id = t.tenant_id AND p.id = t.project_id
         WHERE t.tenant_id = $1 AND t.id = $2`,
        [identity.tenantId, task.id],
      );
      if (namesRes.rowCount) {
        (claimedTask as Record<string, unknown>).workflow_name = namesRes.rows[0].workflow_name;
        (claimedTask as Record<string, unknown>).project_name = namesRes.rows[0].project_name;
      }

      const enrichedTask = await this.enrichWithLLMCredentials(
        identity.tenantId,
        claimedTask,
      );
      const { context: _taskContext, ...claimedTaskBase } = enrichedTask as Record<string, unknown>;
      const instructionContext = (await this.deps.getTaskContext(
        identity.tenantId,
        task.id as string,
        payload.agent_id,
      )) as Record<string, unknown>;
      const instructions =
        typeof instructionContext.instructions === 'string' ? instructionContext.instructions : '';
      const layers = (instructionContext.instruction_layers ?? {}) as Record<string, unknown>;
      const mergedBase = mergeSystemPrompt(claimedTaskBase, layers);
      if ((payload.include_context ?? true) === false) {
        return {
          ...mergedBase,
          tools: toolMatch,
          instructions,
        };
      }

      return {
        ...mergedBase,
        tools: toolMatch,
        instructions,
        context: instructionContext,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async promoteRetryReadyTasks(
    tenantId: string,
    workflowId: string | undefined,
    client: DatabaseClient,
  ): Promise<void> {
    const candidates = await client.query<RetryReadyTaskRow>(
      `SELECT id, workflow_id, work_item_id, is_orchestrator_task, state
         FROM tasks
        WHERE tenant_id = $1
          AND state = 'pending'
          AND metadata ? 'retry_available_at'
          AND ($2::uuid IS NULL OR workflow_id = $2::uuid)
          AND (metadata->>'retry_available_at')::timestamptz <= now()
        ORDER BY ${priorityCase} DESC, created_at ASC
        FOR UPDATE SKIP LOCKED`,
      [tenantId, workflowId ?? null],
    );

    for (const candidate of candidates.rows) {
      const shouldQueue =
        this.deps.parallelismService &&
        (await this.deps.parallelismService.shouldQueueForCapacity(
          tenantId,
          {
            taskId: candidate.id,
            workflowId: candidate.workflow_id,
            workItemId: candidate.work_item_id,
            isOrchestratorTask: candidate.is_orchestrator_task,
            currentState: candidate.state,
          },
          client,
        ));
      if (shouldQueue) {
        continue;
      }

      const updated = await client.query(
        `UPDATE tasks
            SET state = 'ready',
                state_changed_at = now()
          WHERE tenant_id = $1
            AND id = $2
            AND state = 'pending'`,
        [tenantId, candidate.id],
      );
      if (!updated.rowCount) {
        continue;
      }

      await this.deps.eventService.emit(
        {
          tenantId,
          type: 'task.state_changed',
          entityType: 'task',
          entityId: candidate.id,
          actorType: 'system',
          actorId: 'retry_backoff',
          data: {
            from_state: 'pending',
            to_state: 'ready',
            reason: 'retry_backoff_elapsed',
          },
        },
        client,
      );
    }
  }

  async resolveClaimCredentials(
    identity: ApiKeyIdentity,
    taskId: string,
    payload: {
      llm_api_key_claim_handle?: string;
      llm_extra_headers_claim_handle?: string;
    },
  ): Promise<Record<string, unknown>> {
    const agentId = identity.ownerId?.trim();
    if (!agentId) {
      throw new ForbiddenError('Agent identity is not bound to an agent owner.');
    }

    await this.assertAgentOwnsTask(identity.tenantId, taskId, agentId);

    const credentials: Record<string, unknown> = {};
    if (payload.llm_api_key_claim_handle) {
      const storedSecret = parseClaimCredentialHandle(
        payload.llm_api_key_claim_handle,
        taskId,
        'llm_api_key',
        this.deps.claimHandleSecret,
      );
      credentials.llm_api_key = readOAuthToken(storedSecret);
    }
    if (payload.llm_extra_headers_claim_handle) {
      const storedSecret = parseClaimCredentialHandle(
        payload.llm_extra_headers_claim_handle,
        taskId,
        'llm_extra_headers',
        this.deps.claimHandleSecret,
      );
      credentials.llm_extra_headers = parseExtraHeadersSecret(storedSecret);
    }
    return credentials;
  }

  private async enrichWithLLMCredentials(
    tenantId: string,
    task: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const sanitizedTask = stripClaimSecretEchoes(task);
    const roleName = (sanitizedTask.role as string) || '';
    const existingRoleConfig = (sanitizedTask.role_config ?? {}) as Record<string, unknown>;
    const directResolved = await this.resolveTaskRoleConfigOverride(tenantId, existingRoleConfig);
    const fallbackResolved = this.deps.resolveRoleConfig && roleName
      ? await this.deps.resolveRoleConfig(tenantId, roleName)
      : null;
    const resolved = directResolved ?? fallbackResolved;
    if (!resolved) return sanitizedTask;

    const taskWithRoleDefinition = await this.enrichFromRoleDefinition(
      tenantId,
      roleName,
      sanitizedTask,
    );

    let credentials: Record<string, unknown>;
    if (resolved.provider.authMode === 'oauth' && resolved.provider.providerId) {
      credentials = await this.enrichWithOAuthCredentials(
        String(sanitizedTask.id ?? ''),
        resolved,
      );
    } else {
      credentials = await this.resolveApiKeyCredentials(
        tenantId,
        String(sanitizedTask.id ?? ''),
        resolved,
      );
    }

    return attachClaimCredentials(taskWithRoleDefinition, {
      ...pickResolvedLLMMetadata(existingRoleConfig),
      ...credentials,
    });
  }

  private async resolveTaskRoleConfigOverride(
    tenantId: string,
    roleConfig: Record<string, unknown>,
  ): Promise<ResolvedRoleConfig | null> {
    const providerName = typeof roleConfig.llm_provider === 'string'
      ? roleConfig.llm_provider.trim()
      : '';
    const modelId = typeof roleConfig.llm_model === 'string'
      ? roleConfig.llm_model.trim()
      : '';
    if (!providerName || !modelId) {
      return null;
    }

    const result = await this.deps.pool.query<DirectModelLookupRow>(
      `SELECT
          p.id AS provider_id,
          p.name AS provider_name,
          p.base_url AS provider_base_url,
          p.api_key_secret_ref AS provider_api_key_secret_ref,
          p.auth_mode AS provider_auth_mode,
          p.metadata AS provider_metadata,
          m.model_id AS model_id,
          m.context_window AS model_context_window,
          m.endpoint_type AS model_endpoint_type,
          m.reasoning_config AS model_reasoning_config
        FROM llm_models m
        JOIN llm_providers p
          ON p.id = m.provider_id
       WHERE p.tenant_id = $1
         AND p.name = $2
         AND m.model_id = $3
         AND p.is_enabled = true
         AND m.is_enabled = true
       LIMIT 1`,
      [tenantId, providerName, modelId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const providerMetadata = isRecord(row.provider_metadata) ? row.provider_metadata : {};
    const authMode = row.provider_auth_mode ?? 'api_key';
    return {
      provider: {
        name: row.provider_name,
        providerType:
          typeof providerMetadata.providerType === 'string'
            ? providerMetadata.providerType
            : row.provider_name.toLowerCase(),
        baseUrl: row.provider_base_url ?? '',
        apiKeySecretRef: row.provider_api_key_secret_ref,
        authMode,
        providerId: authMode === 'oauth' ? row.provider_id : null,
      },
      model: {
        modelId: row.model_id,
        contextWindow: row.model_context_window,
        endpointType: row.model_endpoint_type,
        reasoningConfig: row.model_reasoning_config,
      },
      reasoningConfig: row.model_reasoning_config,
    };
  }

  private async enrichFromRoleDefinition(
    tenantId: string,
    roleName: string,
    task: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    try {
      const roleRes = await this.deps.pool.query<{
        escalation_target: string | null;
        allowed_tools: string[] | null;
      }>(
        'SELECT escalation_target, allowed_tools FROM role_definitions WHERE tenant_id = $1 AND name = $2 AND is_active = true LIMIT 1',
        [tenantId, roleName],
      );
      const row = roleRes.rows[0];
      const existingRoleConfig = (task.role_config ?? {}) as Record<string, unknown>;
      const updates: Record<string, unknown> = {};

      if (row?.escalation_target) {
        updates.escalation_target = row.escalation_target;
      } else if (task.is_orchestrator_task === true) {
        updates.escalation_target = 'human';
      }
      if (row?.allowed_tools && row.allowed_tools.length > 0) {
        updates.tools = row.allowed_tools;
      }

      if (Object.keys(updates).length === 0) return task;

      return {
        ...task,
        role_config: { ...existingRoleConfig, ...updates },
      };
    } catch {
      return task;
    }
  }

  private async enrichWithOAuthCredentials(
    taskId: string,
    resolved: ResolvedRoleConfig,
  ): Promise<Record<string, unknown>> {
    const oauthService = new OAuthService(this.deps.pool);
    const oauthToken = await oauthService.resolveValidToken(resolved.provider.providerId!);

    const llmFields: Record<string, unknown> = {
      llm_provider: resolved.provider.providerType,
      llm_model: resolved.model.modelId,
      llm_base_url: oauthToken.baseUrl,
      llm_endpoint_type: oauthToken.endpointType,
      llm_auth_mode: 'oauth',
    };

    return {
      ...llmFields,
      ...toClaimStringCredential(
        taskId,
        'llm_api_key',
        'llm_api_key_claim_handle',
        'llm_api_key_secret_ref',
        oauthToken.accessTokenSecret,
        this.deps.claimHandleSecret,
      ),
      ...toClaimObjectCredential(
        taskId,
        'llm_extra_headers',
        'llm_extra_headers_claim_handle',
        'llm_extra_headers_secret_ref',
        oauthToken.extraHeadersSecret,
        this.deps.claimHandleSecret,
      ),
    };
  }

  private async resolveApiKeyCredentials(
    tenantId: string,
    taskId: string,
    resolved: ResolvedRoleConfig,
  ): Promise<Record<string, unknown>> {
    const llmFields: Record<string, unknown> = {
      llm_provider: resolved.provider.providerType,
      llm_model: resolved.model.modelId,
    };
    if (resolved.provider.baseUrl) {
      llmFields.llm_base_url = resolved.provider.baseUrl;
    }
    if (resolved.model.endpointType) {
      llmFields.llm_endpoint_type = resolved.model.endpointType;
    }
    const storedSecret = await this.loadStoredProviderSecret(tenantId, resolved);
    return {
      ...llmFields,
      ...toClaimStringCredential(
        taskId,
        'llm_api_key',
        'llm_api_key_claim_handle',
        'llm_api_key_secret_ref',
        storedSecret,
        this.deps.claimHandleSecret,
      ),
    };
  }

  private async loadStoredProviderSecret(
    tenantId: string,
    resolved: ResolvedRoleConfig,
  ): Promise<string | null> {
    const providerId = resolved.provider.providerId?.trim();
    if (!providerId || isExternalSecretReference(resolved.provider.apiKeySecretRef ?? '')) {
      return resolved.provider.apiKeySecretRef;
    }
    const result = await this.deps.pool.query<{ api_key_secret_ref: string | null }>(
      `SELECT api_key_secret_ref
         FROM llm_providers
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, providerId],
    );
    return result.rows[0]?.api_key_secret_ref ?? resolved.provider.apiKeySecretRef;
  }

  private async assertAgentOwnsTask(tenantId: string, taskId: string, agentId: string): Promise<void> {
    const result = await this.deps.pool.query<{ assigned_agent_id: string | null }>(
      `SELECT assigned_agent_id
         FROM tasks
        WHERE tenant_id = $1
          AND id = $2
        LIMIT 1`,
      [tenantId, taskId],
    );
    if (!result.rowCount) {
      throw new NotFoundError('Task not found');
    }
    if ((result.rows[0]?.assigned_agent_id ?? '') !== agentId) {
      throw new ForbiddenError('Agent cannot resolve claim credentials for a different task.');
    }
  }
}

function mergeSystemPrompt(
  taskResponse: Record<string, unknown>,
  instructionLayers: Record<string, unknown>,
): Record<string, unknown> {
  const flattened = flattenInstructionLayers(instructionLayers);
  if (!flattened) return taskResponse;

  const existing = (taskResponse.role_config ?? {}) as Record<string, unknown>;
  return {
    ...taskResponse,
    role_config: { ...existing, system_prompt: flattened },
  };
}

function readAgentExecutionMode(value: unknown): AgentExecutionMode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'specialist';
  }
  const mode = (value as Record<string, unknown>).execution_mode;
  if (mode === 'orchestrator' || mode === 'hybrid') {
    return mode;
  }
  return 'specialist';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildExecutionModeCondition(mode: AgentExecutionMode): string {
  if (mode === 'orchestrator') {
    return 'tasks.is_orchestrator_task = true';
  }
  if (mode === 'hybrid') {
    return 'true';
  }
  return 'tasks.is_orchestrator_task = false';
}

function stripClaimSecretEchoes(task: Record<string, unknown>): Record<string, unknown> {
  const roleConfig = (task.role_config ?? {}) as Record<string, unknown>;
  const credentials = (task.credentials ?? {}) as Record<string, unknown>;
  if (Object.keys(roleConfig).length === 0 && Object.keys(credentials).length === 0) {
    return task;
  }

  const sanitizedRoleConfig = Object.fromEntries(
    Object.entries(roleConfig).filter(([key]) => !claimRoleConfigSecretKeys.has(key)),
  );
  const sanitizedCredentials = Object.fromEntries(
    Object.entries(credentials).filter(([key]) => !claimRoleConfigSecretKeys.has(key)),
  );
  return {
    ...task,
    role_config: sanitizedRoleConfig,
    credentials: sanitizedCredentials,
  };
}

function attachClaimCredentials(
  task: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const nextCredentials = {
    ...((task.credentials ?? {}) as Record<string, unknown>),
    ...credentials,
  };
  if (Object.keys(nextCredentials).length === 0) {
    return task;
  }
  return {
    ...task,
    credentials: nextCredentials,
  };
}

function pickResolvedLLMMetadata(roleConfig: Record<string, unknown>): Record<string, unknown> {
  const provider = typeof roleConfig.llm_provider === 'string' ? roleConfig.llm_provider : undefined;
  const model = typeof roleConfig.llm_model === 'string' ? roleConfig.llm_model : undefined;
  const baseUrl = typeof roleConfig.llm_base_url === 'string' ? roleConfig.llm_base_url : undefined;
  const endpointType = typeof roleConfig.llm_endpoint_type === 'string' ? roleConfig.llm_endpoint_type : undefined;
  const authMode = typeof roleConfig.llm_auth_mode === 'string' ? roleConfig.llm_auth_mode : undefined;

  return {
    ...(provider ? { llm_provider: provider } : {}),
    ...(model ? { llm_model: model } : {}),
    ...(baseUrl ? { llm_base_url: baseUrl } : {}),
    ...(endpointType ? { llm_endpoint_type: endpointType } : {}),
    ...(authMode ? { llm_auth_mode: authMode } : {}),
  };
}

function toClaimStringCredential(
  taskId: string,
  kind: ClaimCredentialKind,
  handleKey: string,
  secretRefKey: string,
  stored: string | null | undefined,
  claimHandleSecret: string,
): Record<string, unknown> {
  const normalized = typeof stored === 'string' ? stored.trim() : '';
  if (!normalized) {
    return {};
  }
  if (isExternalSecretReference(normalized)) {
    return { [secretRefKey]: normalized };
  }
  return { [handleKey]: createClaimCredentialHandle(taskId, kind, normalized, claimHandleSecret) };
}

function toClaimObjectCredential(
  taskId: string,
  kind: ClaimCredentialKind,
  handleKey: string,
  secretRefKey: string,
  stored: string | null | undefined,
  claimHandleSecret: string,
): Record<string, unknown> {
  const normalized = typeof stored === 'string' ? stored.trim() : '';
  if (!normalized) {
    return {};
  }
  if (isExternalSecretReference(normalized)) {
    return { [secretRefKey]: normalized };
  }
  return { [handleKey]: createClaimCredentialHandle(taskId, kind, normalized, claimHandleSecret) };
}

function parseExtraHeadersSecret(secret: string): Record<string, string> {
  const parsed = JSON.parse(readProviderSecret(secret)) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value] as const] : [],
    ),
  );
}

function createClaimCredentialHandle(
  taskId: string,
  kind: ClaimCredentialKind,
  storedSecret: string,
  claimHandleSecret: string,
): string {
  const iv = randomBytes(CLAIM_CREDENTIAL_HANDLE_IV_LENGTH_BYTES);
  const cipher = createCipheriv(
    CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
    deriveClaimHandleKey(claimHandleSecret),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({
        task_id: taskId,
        kind,
        stored_secret: storedSecret,
      }),
      'utf8',
    ),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `claim:${CLAIM_CREDENTIAL_HANDLE_VERSION}:${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function parseClaimCredentialHandle(
  handle: string,
  expectedTaskId: string,
  expectedKind: ClaimCredentialKind,
  claimHandleSecret: string,
): string {
  const prefix = `claim:${CLAIM_CREDENTIAL_HANDLE_VERSION}:`;
  if (!handle.startsWith(prefix)) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  const encoded = handle.slice(prefix.length);
  const decoded = readClaimCredentialPayload(encoded, claimHandleSecret);
  if (
    decoded.task_id !== expectedTaskId
    || decoded.kind !== expectedKind
    || typeof decoded.stored_secret !== 'string'
  ) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  return decoded.stored_secret;
}

function deriveClaimHandleKey(claimHandleSecret: string): Buffer {
  return createHash('sha256').update(claimHandleSecret, 'utf8').digest();
}

function readClaimCredentialPayload(
  encoded: string,
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const segments = encoded.split('.');
  if (segments.length === 2) {
    return readLegacyClaimCredentialPayload(encoded, claimHandleSecret);
  }
  if (segments.length === 3) {
    return readOpaqueClaimCredentialPayload(segments, claimHandleSecret);
  }
  throw new ValidationError('Invalid claim credential handle.');
}

function readLegacyClaimCredentialPayload(
  encoded: string,
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const separator = encoded.lastIndexOf('.');
  if (separator <= 0 || separator === encoded.length - 1) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  const payload = encoded.slice(0, separator);
  const signature = encoded.slice(separator + 1);
  const expectedSignature = createHmac('sha256', claimHandleSecret).update(payload).digest();
  const providedSignature = Buffer.from(signature, 'base64url');
  if (
    expectedSignature.length !== providedSignature.length
    || !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  return parseClaimCredentialPayload(Buffer.from(payload, 'base64url').toString('utf8'));
}

function readOpaqueClaimCredentialPayload(
  segments: string[],
  claimHandleSecret: string,
): ClaimCredentialPayload {
  const [ivBase64, encryptedBase64, authTagBase64] = segments;
  if (!ivBase64 || !encryptedBase64 || !authTagBase64) {
    throw new ValidationError('Invalid claim credential handle.');
  }
  try {
    const decipher = createDecipheriv(
      CLAIM_CREDENTIAL_HANDLE_ENCRYPTION_ALGORITHM,
      deriveClaimHandleKey(claimHandleSecret),
      Buffer.from(ivBase64, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64url')),
      decipher.final(),
    ]);
    return parseClaimCredentialPayload(decrypted.toString('utf8'));
  } catch {
    throw new ValidationError('Invalid claim credential handle.');
  }
}

function parseClaimCredentialPayload(payload: string): ClaimCredentialPayload {
  try {
    return JSON.parse(payload) as ClaimCredentialPayload;
  } catch {
    throw new ValidationError('Invalid claim credential handle.');
  }
}
