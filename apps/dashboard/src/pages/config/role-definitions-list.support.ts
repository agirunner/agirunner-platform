import type { RoleDefinition } from './role-definitions-page.support.js';

export function buildRoleDetailSummary(role: RoleDefinition, modelLabel: string) {
  return {
    model: { title: 'Model', label: modelLabel || 'System default' },
    tools: {
      title: 'Tools',
      label: `${role.allowed_tools?.length ?? 0} tool${role.allowed_tools?.length === 1 ? '' : 's'} enabled`,
    },
    executionContainer: {
      title: 'Execution container',
      label: summarizeExecutionContainer(role),
    },
    governance: {
      title: 'Verification and escalation',
      label: summarizeGovernance(role),
    },
    promptPreview: summarizePromptPreview(role.system_prompt ?? ''),
  };
}

function summarizeExecutionContainer(role: RoleDefinition): string {
  const config = role.execution_container_config;
  if (!config) {
    return 'Inherit runtime defaults';
  }

  const parts = [
    config.image?.trim(),
    config.cpu?.trim() ? `CPU ${config.cpu.trim()}` : null,
    config.memory?.trim() ? `Memory ${config.memory.trim()}` : null,
    config.pull_policy?.trim() ? `Pull ${config.pull_policy.trim()}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'Inherit runtime defaults';
}

function summarizeGovernance(role: RoleDefinition): string {
  const parts = [
    humanizeGovernanceLabel(role.verification_strategy),
    role.escalation_target?.trim()
      ? `Escalates to ${role.escalation_target.trim()}${role.max_escalation_depth ? ` (max ${role.max_escalation_depth})` : ''}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' | ') : 'No explicit verification or escalation override';
}

function summarizePromptPreview(value: string): string {
  const trimmed = value.trim();
  return trimmed || 'No system prompt configured.';
}

function humanizeGovernanceLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const words = trimmed
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  return words
    .map((part, index) => (index === 0 ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}
