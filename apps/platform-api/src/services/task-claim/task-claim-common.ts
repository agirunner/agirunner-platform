import type { DatabaseClient } from '../../db/database.js';
import { ValidationError } from '../../errors/domain-errors.js';
import { logTaskGovernanceTransition } from '../../logging/task-governance-log.js';
import type { LogService } from '../../logging/log-service.js';
import type { ResolvedRoleConfig } from '../model-catalog/model-catalog-service.js';
import { DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS } from './task-claim-constants.js';
import type {
  AgentExecutionMode,
  ClaimPeerAgentRow,
} from './task-claim-types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function toNullableDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeAgentPlaybookScope(explicitPlaybookId: string | null, metadata: unknown): string | null {
  if (explicitPlaybookId && explicitPlaybookId.trim().length > 0) {
    return explicitPlaybookId.trim();
  }
  if (!isRecord(metadata)) {
    return null;
  }
  const playbookId = metadata.playbook_id;
  return typeof playbookId === 'string' && playbookId.trim().length > 0 ? playbookId.trim() : null;
}

export function readAgentExecutionMode(value: unknown): AgentExecutionMode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'specialist';
  }
  const mode = (value as Record<string, unknown>).execution_mode;
  if (mode === 'orchestrator' || mode === 'hybrid') {
    return mode;
  }
  return 'specialist';
}

export function agentCanClaimOrchestratorTasks(metadata: unknown): boolean {
  return readAgentExecutionMode(metadata) !== 'specialist';
}

export function isFreshClaimPeer(peer: ClaimPeerAgentRow, freshnessMultiplier: number): boolean {
  const lastHeartbeatAt = toNullableDate(peer.last_heartbeat_at);
  if (!lastHeartbeatAt) {
    return false;
  }
  const heartbeatIntervalSeconds =
    typeof peer.heartbeat_interval_seconds === 'number' && peer.heartbeat_interval_seconds > 0
      ? peer.heartbeat_interval_seconds
      : 30;
  const freshnessWindowMs = heartbeatIntervalSeconds * Math.max(freshnessMultiplier, 1) * 1000;
  return Date.now() - lastHeartbeatAt.getTime() <= freshnessWindowMs;
}

export function buildExecutionModeCondition(mode: AgentExecutionMode): string {
  const backendExpression = `COALESCE(
    tasks.execution_backend::text,
    CASE
      WHEN tasks.is_orchestrator_task = true THEN 'runtime_only'
      ELSE 'runtime_plus_task'
    END
  )`;
  if (mode === 'orchestrator') {
    return `${backendExpression} = 'runtime_only'`;
  }
  if (mode === 'hybrid') {
    return 'true';
  }
  return `${backendExpression} = 'runtime_plus_task'`;
}

export function resolveNativeSearchMode(
  roleConfig: Record<string, unknown>,
  resolved: ResolvedRoleConfig,
): string | null {
  if (!Array.isArray(roleConfig.tools)) {
    return null;
  }
  const hasNativeSearch = roleConfig.tools.some(
    (tool) => typeof tool === 'string' && tool.trim() === 'native_search',
  );
  if (!hasNativeSearch) {
    return null;
  }
  return resolved.nativeSearch?.mode ?? null;
}

export function buildMissingTaskModelConfigError(roleName: string): ValidationError {
  const trimmedRoleName = roleName.trim();
  const label = trimmedRoleName ? `role '${trimmedRoleName}'` : 'this task';
  return new ValidationError(
    `No LLM model is configured for ${label}. Assign a model to the role or set a default model on the LLM Providers page before claiming tasks.`,
    { role: trimmedRoleName || null },
  );
}

export function mergeSystemPrompt(
  taskResponse: Record<string, unknown>,
  flattenedPrompt: string,
): Record<string, unknown> {
  if (!flattenedPrompt) return taskResponse;

  const existing = (taskResponse.role_config ?? {}) as Record<string, unknown>;
  return {
    ...taskResponse,
    role_config: { ...existing, system_prompt: flattenedPrompt },
  };
}

export function readAssembledPromptWarningThreshold(context: Record<string, unknown>): number {
  const agenticSettings = isRecord(context.agentic_settings) ? context.agentic_settings : {};
  const value = agenticSettings.assembled_prompt_warning_threshold_chars;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_ASSEMBLED_PROMPT_WARNING_THRESHOLD_CHARS;
}

export async function logAssembledPromptWarningIfNeeded(
  logService: LogService | undefined,
  input: {
    tenantId: string;
    executor: DatabaseClient;
    task: Record<string, unknown>;
    prompt: string;
    warningThresholdChars: number;
  },
): Promise<void> {
  if (input.prompt.length <= input.warningThresholdChars) {
    return;
  }

  await logTaskGovernanceTransition(logService, {
    tenantId: input.tenantId,
    level: 'warn',
    operation: 'task.execution_context_prompt_warning',
    executor: input.executor,
    task: input.task,
    payload: {
      assembled_prompt_length_chars: input.prompt.length,
      warning_threshold_chars: input.warningThresholdChars,
    },
  });
}
