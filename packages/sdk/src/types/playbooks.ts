export interface Playbook {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  outcome: string;
  lifecycle: 'planned' | 'ongoing';
  definition: Record<string, unknown>;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePlaybookInput {
  name: string;
  slug?: string;
  description?: string;
  outcome: string;
  lifecycle?: 'planned' | 'ongoing';
  definition: Record<string, unknown>;
}

export interface UpdatePlaybookInput {
  name?: string;
  slug?: string;
  description?: string;
  outcome?: string;
  lifecycle?: 'planned' | 'ongoing';
  definition?: Record<string, unknown>;
}
