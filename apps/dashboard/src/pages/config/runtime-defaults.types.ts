export interface RuntimeDefault {
  id: string;
  config_key: string;
  config_value: string;
  config_type: string;
  description: string | null;
}

export interface FieldDefinition {
  key: string;
  label: string;
  description: string;
  configType: 'string' | 'number' | 'boolean';
  placeholder: string;
  section:
    | 'containers'
    | 'process_logging'
    | 'server_timeouts'
    | 'runtime_api'
    | 'llm_transport'
    | 'tool_timeouts'
    | 'connected_platform'
    | 'realtime_transport'
    | 'pool_management'
    | 'workflow_activation'
    | 'container_manager'
    | 'worker_supervision'
    | 'agent_supervision'
    | 'webhook_delivery'
    | 'platform_loops'
    | 'task_timeouts'
    | 'container_timeouts'
    | 'container_reuse'
    | 'lifecycle_timeouts'
    | 'workspace_timeouts'
    | 'workspace_operations'
    | 'capture_timeouts'
    | 'secrets_timeouts'
    | 'subagent_timeouts'
    | 'agent_context'
    | 'orchestrator_context'
    | 'agent_safeguards'
    | 'fleet';
  options?: readonly string[];
  inputMode?: 'numeric' | 'decimal';
  min?: number;
  max?: number;
  step?: number;
}

export interface SectionDefinition {
  key: FieldDefinition['section'];
  title: string;
  description: string;
}

export type FormValues = Record<string, string>;
