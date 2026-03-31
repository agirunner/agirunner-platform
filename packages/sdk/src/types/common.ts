export type ApiScope = 'agent' | 'worker' | 'admin';

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskState =
  | 'pending'
  | 'ready'
  | 'claimed'
  | 'in_progress'
  | 'escalated'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval'
  | 'output_pending_assessment';

export type WorkflowState =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface ApiListResponse<T> {
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiDataResponse<T> {
  data: T;
}

export interface AuthTokenResponse {
  token: string;
  scope: ApiScope;
  tenant_id: string;
}
