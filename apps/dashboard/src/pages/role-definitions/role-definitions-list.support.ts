import type { RoleDefinition } from './role-definitions-page.support.js';

export function buildRoleDetailSummary(role: RoleDefinition, modelLabel: string) {
  return {
    model: { title: 'Model', label: modelLabel || 'System default' },
    tools: {
      title: 'Tools',
      label: `${role.allowed_tools?.length ?? 0} tool${role.allowed_tools?.length === 1 ? '' : 's'} enabled`,
    },
    executionContainer: {
      title: 'Specialist Execution',
      label: summarizeExecutionContainer(role),
    },
    promptPreview: summarizePromptPreview(role.system_prompt ?? ''),
  };
}

function summarizeExecutionContainer(role: RoleDefinition): string {
  const config = role.execution_container_config;
  if (!config) {
    return 'Inherit platform defaults';
  }

  const parts = [
    config.image?.trim(),
    config.cpu?.trim() ? `CPU ${config.cpu.trim()}` : null,
    config.memory?.trim() ? `Memory ${config.memory.trim()}` : null,
    config.pull_policy?.trim() ? `Pull ${config.pull_policy.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'Inherit platform defaults';
}
function summarizePromptPreview(value: string): string {
  const trimmed = value.trim();
  return trimmed || 'No system prompt configured.';
}
