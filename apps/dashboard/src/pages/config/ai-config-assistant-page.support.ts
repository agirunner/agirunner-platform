export interface ConfigSuggestion {
  path: string;
  current_value?: string;
  suggested_value: string;
  description: string;
}

export interface AssistantMessageRecord {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  suggestions?: ConfigSuggestion[];
}

export interface AssistantSummaryCard {
  label: string;
  value: string;
  detail: string;
}

export interface AssistantStarterPrompt {
  label: string;
  prompt: string;
}

export interface SuggestionDestination {
  href: string;
  label: string;
}

export const ASSISTANT_STARTER_PROMPTS: AssistantStarterPrompt[] = [
  {
    label: 'Audit runtimes',
    prompt:
      'Review runtime defaults and call out the highest-risk configuration gaps for orchestrators and specialists.',
  },
  {
    label: 'Provider posture',
    prompt:
      'Summarize the current LLM provider and model assignment posture and highlight anything operators should fix first.',
  },
  {
    label: 'Playbook review',
    prompt:
      'What playbook configuration or workflow controls are most likely to block a clean SDLC run right now?',
  },
  {
    label: 'Integration hygiene',
    prompt:
      'Review webhook, trigger, and integration settings and explain what should be validated before launch.',
  },
];

export function summarizeAssistantSession(
  messages: AssistantMessageRecord[],
  reviewedSuggestionCount: number,
): AssistantSummaryCard[] {
  const assistantReplies = messages.filter((message) => message.role === 'assistant').length;
  const suggestionCount = messages.reduce(
    (count, message) => count + (message.suggestions?.length ?? 0),
    0,
  );
  return [
    {
      label: 'Conversation',
      value: messages.length === 0 ? 'No messages' : `${messages.length} turns`,
      detail:
        assistantReplies === 0
          ? 'Ask a configuration question to start the advisory session.'
          : `${assistantReplies} assistant response${assistantReplies === 1 ? '' : 's'} recorded in this session.`,
    },
    {
      label: 'Suggestions',
      value: suggestionCount === 0 ? 'No suggestions yet' : `${suggestionCount} suggestions`,
      detail:
        suggestionCount === 0
          ? 'The assistant has not proposed any follow-up actions yet.'
          : 'Suggestions are advisory and should be reviewed in the relevant config surface before applying changes.',
    },
    {
      label: 'Review posture',
      value:
        reviewedSuggestionCount === 0
          ? 'Nothing reviewed'
          : `${reviewedSuggestionCount} reviewed`,
      detail:
        reviewedSuggestionCount === 0
          ? 'Mark suggestions as reviewed once you have checked the underlying settings.'
          : 'Reviewed suggestions stay visible so you can keep the session context intact.',
    },
  ];
}

export function resolveSuggestionDestination(path: string): SuggestionDestination | null {
  const normalized = path.toLowerCase();
  if (
    normalized.startsWith('runtime.') ||
    normalized.startsWith('agent.') ||
    normalized.startsWith('global_') ||
    normalized.startsWith('tools.web_search')
  ) {
    return { href: '/config/runtimes', label: 'Open runtime defaults' };
  }
  if (
    normalized.startsWith('llm.') ||
    normalized.startsWith('model.') ||
    normalized.startsWith('provider.')
  ) {
    return { href: '/config/llm', label: 'Open LLM settings' };
  }
  if (normalized.startsWith('playbook.') || normalized.startsWith('workflow.')) {
    return { href: '/config/playbooks', label: 'Open playbooks' };
  }
  if (normalized.startsWith('integration.')) {
    return { href: '/config/integrations', label: 'Open integrations' };
  }
  if (normalized.startsWith('webhook.')) {
    return { href: '/config/webhooks', label: 'Open webhooks' };
  }
  return null;
}
