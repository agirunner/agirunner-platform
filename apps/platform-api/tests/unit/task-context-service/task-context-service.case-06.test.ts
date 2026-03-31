import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/document-reference/document-reference-service.js', () => ({
  listTaskDocuments: vi.fn(async () => []),
}));

vi.mock('../../../src/services/orchestrator-task-context/orchestrator-task-context.js', () => ({
  buildOrchestratorTaskContext: vi.fn(async () => null),
}));

import {
  buildTaskContext,
  summarizeTaskContextAttachments,
} from '../../../src/services/task-context-service/task-context-service.js';

describe('buildTaskContext active stage semantics', () => {
  it('includes the assigned role description in the specialist role instruction layer', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM workflows p')) {
          return {
            rows: [
              {
                id: 'workflow-role',
                name: 'Workflow role',
                lifecycle: 'planned',
                context: {},
                git_branch: 'main',
                parameters: {},
                resolved_config: {},
                instruction_config: {},
                metadata: {},
                playbook_id: 'playbook-role',
                playbook_name: 'Role playbook',
                playbook_outcome: 'Ship work',
                playbook_definition: {
                  lifecycle: 'planned',
                  process_instructions: 'Implement the requested change.',
                  board: {
                    columns: [
                      { id: 'planned', label: 'Planned' },
                      { id: 'done', label: 'Done', is_terminal: true },
                    ],
                  },
                  stages: [{ name: 'implementation', goal: 'Build the change' }],
                },
                workspace_spec_version: null,
              },
            ],
          };
        }
        if (sql.includes('SELECT DISTINCT wi.stage_name')) {
          return { rows: [{ stage_name: 'implementation' }] };
        }
        if (sql.includes('FROM role_definitions rd')) {
          return {
            rows: [
              {
                name: 'developer',
                description: 'Implements the requested change.',
                escalation_target: 'human',
                allowed_tools: ['shell', 'web_fetch'],
                skills: [
                  {
                    id: 'skill-1',
                    name: 'Structured Search',
                    slug: 'structured-search',
                    summary: 'Search deliberately.',
                    content: 'Always open with a search plan before using remote research tools.',
                    sort_order: 0,
                  },
                ],
                remote_mcp_servers: [
                  {
                    id: 'mcp-1',
                    name: 'Tavily Search',
                    slug: 'tavily-search',
                    description: 'Web search and lightweight research.',
                    endpoint_url: 'https://mcp.tavily.com/mcp/{tenant}',
                    auth_mode: 'parameterized',
                    verified_transport: 'streamable_http',
                    verification_contract_version: 'remote-mcp-v1',
                    verified_capability_summary: {
                      tool_count: 2,
                      resource_count: 1,
                      prompt_count: 0,
                    },
                    discovered_tools_snapshot: [
                      { original_name: 'search', description: 'Search the web' },
                      { original_name: 'research', description: 'Research deeply' },
                    ],
                    discovered_resources_snapshot: [
                      { uri: 'docs://guides/getting-started', name: 'Getting Started' },
                    ],
                    discovered_prompts_snapshot: [],
                    parameters: [],
                  },
                ],
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const context = await buildTaskContext(db as never, 'tenant-1', {
      id: 'task-role',
      workflow_id: 'workflow-role',
      depends_on: [],
      role: 'developer',
      role_config: {
        description: 'Implements the requested change.',
        instructions: 'Write the code and verify it before handoff.',
      },
    });

    const roleLayer = (context.instruction_layers as Record<string, any>).role ?? {};
    expect(roleLayer.content).toContain('Role description: Implements the requested change.');
    expect(roleLayer.content).toContain('Write the code and verify it before handoff.');
    expect(roleLayer.content).toContain('## Specialist Skills');
    expect(roleLayer.content).toContain('### Structured Search');
    expect(roleLayer.content).toContain(
      'Always open with a search plan before using remote research tools.',
    );
    expect(roleLayer.content).toContain('## Remote MCP Servers Available');
    expect(roleLayer.content).toContain('Tavily Search');
    expect(roleLayer.content).toContain('Verified capabilities: 2 tools, 1 resource, 0 prompts.');
  });

});
