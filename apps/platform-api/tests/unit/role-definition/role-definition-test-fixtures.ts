import { vi } from 'vitest';

export function createMockPool() {
  return { query: vi.fn() };
}

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const ROLE_ID = '00000000-0000-0000-0000-000000000099';
export const ENVIRONMENT_ID = '00000000-0000-0000-0000-000000000777';
export const MCP_SERVER_ID = '00000000-0000-0000-0000-000000000888';
export const SKILL_ID = '00000000-0000-0000-0000-000000000889';

export function buildRoleRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: ROLE_ID,
    tenant_id: TENANT_ID,
    name: 'developer',
    description: 'Implements features',
    system_prompt: 'You are a developer.',
    allowed_tools: ['file_read', 'file_write'],
    model_preference: 'gpt-5-mini',
    verification_strategy: 'peer_review',
    execution_environment_id: null,
    escalation_target: null,
    max_escalation_depth: 5,
    is_active: true,
    version: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ee_id: null,
    ee_name: null,
    ee_source_kind: null,
    ee_catalog_key: null,
    ee_catalog_version: null,
    ee_image: null,
    ee_cpu: null,
    ee_memory: null,
    ee_pull_policy: null,
    ee_compatibility_status: null,
    ee_verification_contract_version: null,
    ee_verified_metadata: null,
    ee_tool_capabilities: null,
    ee_bootstrap_commands: null,
    ee_bootstrap_required_domains: null,
    ee_catalog_support_status: null,
    mcp_server_ids: [],
    skill_ids: [],
    mcp_servers: [],
    skills: [],
    ...overrides,
  };
}
