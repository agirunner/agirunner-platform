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
  configType: 'string' | 'number';
  placeholder: string;
  section:
    | 'containers'
    | 'server_timeouts'
    | 'llm_transport'
    | 'tool_timeouts'
    | 'connected_platform'
    | 'workflow_activation'
    | 'container_manager'
    | 'worker_supervision'
    | 'task_timeouts'
    | 'container_timeouts'
    | 'lifecycle_timeouts'
    | 'workspace_timeouts'
    | 'capture_timeouts'
    | 'secrets_timeouts'
    | 'subagent_timeouts'
    | 'agent_context'
    | 'orchestrator_context'
    | 'agent_safeguards'
    | 'fleet'
    | 'search';
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
