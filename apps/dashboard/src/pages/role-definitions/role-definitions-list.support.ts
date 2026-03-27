import type { RoleDefinition } from './role-definitions-page.support.js';

export function buildRoleDetailSummary(role: RoleDefinition, modelLabel: string) {
  const toolCount = role.allowed_tools?.length ?? 0;
  const mcpServerCount = role.mcp_server_ids?.length ?? 0;
  const skillCount = Math.max(role.skill_ids?.length ?? 0, role.skills?.length ?? 0);

  return {
    model: { title: 'Model', label: modelLabel || 'System default' },
    tools: {
      title: 'Tools & MCP',
      label: `${toolCount} tool${toolCount === 1 ? '' : 's'} and ${mcpServerCount} MCP server${mcpServerCount === 1 ? '' : 's'} enabled`,
    },
    skills: {
      title: 'Skills',
      label: `${skillCount} skill${skillCount === 1 ? '' : 's'} assigned`,
    },
    executionEnvironment: {
      title: 'Execution Environment',
      label: summarizeExecutionEnvironment(role),
    },
    promptPreview: summarizePromptPreview(role.system_prompt ?? ''),
  };
}

function summarizeExecutionEnvironment(role: RoleDefinition): string {
  const environment = role.execution_environment;
  if (!environment) {
    return 'Default environment';
  }

  const parts = [
    environment.name,
    environment.image,
    `CPU ${environment.cpu}`,
    `Memory ${environment.memory}`,
    `Pull ${environment.pull_policy}`,
  ];

  if (environment.support_status === 'deprecated') {
    parts.push('Support deprecated');
  }
  if (environment.support_status === 'blocked') {
    parts.push('Support blocked');
  }

  return parts.join(' | ');
}

function summarizePromptPreview(value: string): string {
  const trimmed = value.trim();
  return trimmed || 'No system prompt configured.';
}
