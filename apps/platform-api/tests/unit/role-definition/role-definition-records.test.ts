import { describe, expect, it } from 'vitest';

import { sanitizeRoleDefinitionRow } from '../../../src/services/role-definition/role-definition-records.js';

describe('role-definition records', () => {
  it('redacts secret-bearing role fields from query rows', () => {
    const now = new Date('2026-03-30T00:00:00.000Z');

    const result = sanitizeRoleDefinitionRow({
      id: 'role-1',
      tenant_id: 'tenant-1',
      name: 'developer',
      description: 'secret:provider-api-key-openai',
      system_prompt: 'secret:provider-api-key-openai',
      allowed_tools: ['shell'],
      model_preference: 'secret:model-key',
      verification_strategy: 'peer_review',
      execution_environment_id: null,
      escalation_target: null,
      max_escalation_depth: 5,
      is_active: true,
      version: 1,
      created_at: now,
      updated_at: now,
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
      mcp_server_ids: ['server-1'],
      skill_ids: ['skill-1'],
      mcp_servers: [{ id: 'server-1', name: 'Docs MCP' }],
      skills: [{ id: 'skill-1', name: 'Docs Research' }],
    });

    expect(result).toEqual(
      expect.objectContaining({
        description: 'redacted://role-definition-secret',
        system_prompt: 'redacted://role-definition-secret',
        model_preference: 'redacted://role-definition-secret',
        mcp_server_ids: ['server-1'],
        skill_ids: ['skill-1'],
      }),
    );
  });
});
