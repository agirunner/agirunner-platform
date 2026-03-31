export interface Agent {
  id: string;
  tenant_id?: string;
  worker_id: string | null;
  name: string;
  status: string;
  current_task_id: string | null;
  heartbeat_interval_seconds: number;
  last_heartbeat_at: string;
  metadata?: Record<string, unknown>;
  routing_tags?: string[];
  registered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  tenant_id?: string;
  name: string;
  runtime_type: string;
  connection_mode: string;
  status: string;
  routing_tags: string[];
  current_task_id?: string | null;
  host_info: Record<string, unknown>;
  metadata: Record<string, unknown>;
  heartbeat_interval_seconds: number;
  last_heartbeat_at: string;
  connected_at?: string | null;
  created_at: string;
  updated_at: string;
}
