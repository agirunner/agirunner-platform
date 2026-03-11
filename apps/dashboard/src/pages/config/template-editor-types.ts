/**
 * Template editor types — matches backend schema exactly.
 *
 * Source of truth:
 *   - workflow-engine.ts: TemplateTaskDefinition, RuntimeConfig, TemplateSchema
 *   - workflow-model.ts: WorkflowPhaseDefinition, WorkflowGateType
 *   - template-variables.ts: TemplateVariableDefinition
 *   - task-lifecycle-policy.ts: LifecyclePolicy, RetryPolicy, EscalationPolicy, ReworkPolicy
 *   - DB: templates table (id, name, slug, description, version, is_built_in, is_published, schema)
 */

// ---------------------------------------------------------------------------
// Task definitions
// ---------------------------------------------------------------------------

export type OutputStorageMode = 'inline' | 'artifact' | 'git';
export const OUTPUT_STORAGE_MODES: OutputStorageMode[] = ['inline', 'artifact', 'git'];

export interface OutputStateDeclaration {
  mode: OutputStorageMode;
  path?: string;
  media_type?: string;
  summary?: string;
}

export interface TemplateTaskDefinition {
  id: string;
  title_template: string;
  role?: string;
  depends_on?: string[];
  blocked_by?: string[];
  requires_approval?: boolean;
  requires_output_review?: boolean;
  review_prompt?: string;
  input_template?: Record<string, unknown>;
  context_template?: Record<string, unknown>;
  capabilities_required?: string[];
  role_config?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  lifecycle?: LifecyclePolicy;
  output_state?: Record<string, OutputStateDeclaration>;
  timeout_minutes?: number;
  auto_retry?: boolean;
  max_retries?: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Workflow phases
// ---------------------------------------------------------------------------

export type WorkflowGateType = 'none' | 'all_complete' | 'manual' | 'auto';
export const GATE_TYPES: WorkflowGateType[] = ['none', 'all_complete', 'manual', 'auto'];

export interface WorkflowPhaseDefinition {
  name: string;
  gate: WorkflowGateType;
  parallel: boolean;
  tasks: string[];
}

export interface WorkflowDefinition {
  phases: WorkflowPhaseDefinition[];
  patterns?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export type VariableType = 'string' | 'number' | 'boolean' | 'json';
export const VARIABLE_TYPES: VariableType[] = ['string', 'number', 'boolean', 'json'];

export interface TemplateVariableDefinition {
  name: string;
  type: VariableType;
  required?: boolean;
  default?: unknown;
  description?: string;
}

// ---------------------------------------------------------------------------
// Lifecycle policy
// ---------------------------------------------------------------------------

export type RetryBackoffStrategy = 'fixed' | 'linear' | 'exponential';
export const BACKOFF_STRATEGIES: RetryBackoffStrategy[] = ['fixed', 'linear', 'exponential'];

export interface RetryPolicy {
  max_attempts: number;
  backoff_strategy: RetryBackoffStrategy;
  initial_backoff_seconds: number;
  retryable_categories: string[];
}

export interface EscalationPolicy {
  role: string;
  title_template: string;
  instructions?: string;
  enabled: boolean;
}

export interface ReworkPolicy {
  max_cycles: number;
}

export interface LifecyclePolicy {
  retry_policy?: RetryPolicy;
  escalation?: EscalationPolicy;
  rework?: ReworkPolicy;
}

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

export type PullPolicy = 'always' | 'if-not-present' | 'never';
export const PULL_POLICIES: PullPolicy[] = ['always', 'if-not-present', 'never'];

export type PoolMode = 'warm' | 'cold';

export interface RuntimeConfig {
  pool_mode?: PoolMode;
  max_runtimes?: number;
  priority?: number;
  idle_timeout_seconds?: number;
  grace_period_seconds?: number;
  image?: string;
  pull_policy?: PullPolicy;
  cpu?: string;
  memory?: string;
}

// ---------------------------------------------------------------------------
// Template schema (the JSONB `schema` column)
// ---------------------------------------------------------------------------

export interface TemplateSchema {
  tasks: TemplateTaskDefinition[];
  workflow?: WorkflowDefinition;
  variables?: TemplateVariableDefinition[];
  runtime?: RuntimeConfig;
  lifecycle?: LifecyclePolicy;
  config?: Record<string, unknown>;
  default_instruction_config?: Record<string, unknown>;
  patterns?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Template (API response shape — DB row)
// ---------------------------------------------------------------------------

export interface TemplateResponse {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  version: number;
  is_built_in: boolean;
  is_published: boolean;
  schema: TemplateSchema;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Editor state — wraps TemplateResponse for local editing
// ---------------------------------------------------------------------------

export interface TemplateEditorState {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: number;
  is_built_in: boolean;
  is_published: boolean;
  schema: TemplateSchema;
  created_at?: string;
  updated_at?: string;
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createEmptyTask(phaseIndex: number, taskIndex: number): TemplateTaskDefinition {
  return {
    id: `task_${phaseIndex + 1}_${taskIndex + 1}`,
    title_template: 'New Task',
    role: 'developer',
  };
}

export function createEmptyPhase(index: number): WorkflowPhaseDefinition {
  return {
    name: `Phase ${index + 1}`,
    gate: 'all_complete',
    parallel: true,
    tasks: [],
  };
}

export function createEmptySchema(): TemplateSchema {
  return {
    tasks: [],
    workflow: { phases: [] },
  };
}

export function createEmptyTemplate(): TemplateEditorState {
  return {
    id: '',
    name: '',
    slug: '',
    description: '',
    version: 1,
    is_built_in: false,
    is_published: false,
    schema: createEmptySchema(),
  };
}

export function responseToEditorState(response: TemplateResponse): TemplateEditorState {
  return {
    id: response.id,
    name: response.name,
    slug: response.slug,
    description: response.description ?? '',
    version: response.version,
    is_built_in: response.is_built_in,
    is_published: response.is_published,
    schema: response.schema ?? createEmptySchema(),
    created_at: response.created_at,
    updated_at: response.updated_at,
  };
}

export function editorStateToCreatePayload(state: TemplateEditorState) {
  return {
    name: state.name,
    slug: state.slug,
    description: state.description || undefined,
    is_published: state.is_published,
    schema: state.schema,
  };
}

export function editorStateToPatchPayload(state: TemplateEditorState) {
  return {
    name: state.name,
    slug: state.slug,
    description: state.description || undefined,
    is_published: state.is_published,
    schema: state.schema,
  };
}
