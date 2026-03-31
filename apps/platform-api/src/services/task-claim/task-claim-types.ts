import type { ApiKeyIdentity } from '../../auth/api-key.js';
import type { DatabaseClient, DatabasePool } from '../../db/database.js';
import type { LogService } from '../../logging/log-service.js';
import type { TaskState } from '../../orchestration/task-state-machine.js';
import type { ResolvedRoleConfig } from '../model-catalog/model-catalog-service.js';
import type { PlaybookTaskParallelismService } from '../playbook/playbook-task-parallelism-service.js';
import type { ExecutionContainerLeaseService } from '../execution-environment/execution-container-lease-service.js';
import type {
  ExecutionContainerContract,
  ExecutionEnvironmentSummary,
} from '../execution-environment/contract.js';
import { EventService } from '../event/event-service.js';
import type { ToolOwner } from '../tool-tag-service.js';

export type AgentExecutionMode = 'specialist' | 'orchestrator' | 'hybrid';
export type ClaimCredentialKind = 'llm_api_key' | 'llm_extra_headers' | 'mcp_parameter' | 'mcp_oauth';

export interface ClaimCredentialPayload {
  task_id?: string;
  kind?: string;
  stored_secret?: string;
  provider_id?: string;
}

export interface TaskClaimDependencies {
  pool: DatabasePool;
  eventService: EventService;
  logService?: LogService;
  toTaskResponse: (task: Record<string, unknown>) => Record<string, unknown>;
  getTaskContext: (tenantId: string, taskId: string, agentId?: string) => Promise<unknown>;
  resolveRoleConfig?: (tenantId: string, roleName: string) => Promise<ResolvedRoleConfig | null>;
  parallelismService?: PlaybookTaskParallelismService;
  executionContainerLeaseService?: Pick<ExecutionContainerLeaseService, 'reserveForTask'>;
  claimHandleSecret: string;
}

export interface RetryReadyTaskRow {
  id: string;
  workflow_id: string | null;
  work_item_id: string | null;
  is_orchestrator_task: boolean;
  state: TaskState;
}

export interface TaskLLMResolution {
  roleName: string;
  existingRoleConfig: Record<string, unknown>;
  resolved: ResolvedRoleConfig;
}

export interface TaskLoopContract {
  loopMode: 'reactive' | 'tpaov';
  maxIterations: number;
  llmMaxRetries: number;
}

export interface ResolvedTaskExecutionEnvironment {
  executionContainer: ExecutionContainerContract;
  executionEnvironment: ExecutionEnvironmentSummary;
  snapshot: ExecutionEnvironmentSummary;
}

export interface ClaimPeerAgentRow {
  id: string;
  routing_tags: string[] | null;
  last_claim_at: string | Date | null;
  last_heartbeat_at: string | Date | null;
  heartbeat_interval_seconds: number | null;
  metadata: Record<string, unknown> | null;
}

export interface ClaimableExecutionEnvironmentRow {
  id: string;
  name: string;
  source_kind: string;
  catalog_key: string | null;
  catalog_version: number | null;
  image: string;
  cpu: string;
  memory: string;
  pull_policy: string;
  compatibility_status: string;
  verification_contract_version: string | null;
  verified_metadata: unknown;
  tool_capabilities: unknown;
  bootstrap_commands: unknown;
  bootstrap_required_domains: unknown;
  support_status: string | null;
}

export interface TaskClaimPayload {
  agent_id: string;
  worker_id?: string;
  routing_tags?: string[];
  workflow_id?: string;
  playbook_id?: string;
  include_context?: boolean;
}

export interface ClaimResponseBuildInput {
  identity: ApiKeyIdentity;
  payload: Pick<TaskClaimPayload, 'agent_id' | 'worker_id' | 'include_context'>;
  task: Record<string, unknown>;
  llmResolution: TaskLLMResolution;
  loopContract: TaskLoopContract;
  resolvedExecutionEnvironment: ResolvedTaskExecutionEnvironment | null;
  toolMatch: { matched: string[]; unavailable_optional: string[] };
  client: DatabaseClient;
}

export type ToolOwnerMap = Record<string, ToolOwner>;
