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

export interface AssistantSessionStageSummary {
  badge: string;
  title: string;
  detail: string;
  nextAction: string;
}

export interface AssistantReviewBucket {
  key: string;
  label: string;
  href?: string;
  actionLabel?: string;
  pendingCount: number;
  reviewedCount: number;
  detail: string;
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
  {
    label: 'Tool catalog',
    prompt:
      'Review the tool catalog posture and highlight tools that are missing descriptions, mis-categorized, or not yet granted to the roles that need them.',
  },
  {
    label: 'Platform instructions',
    prompt:
      'Check the current platform instructions for gaps, stale guidance, or missing role-specific context that could affect agent behavior.',
  },
];

export function summarizeAssistantSession(
  messages: AssistantMessageRecord[],
  reviewedSuggestionCount: number,
): AssistantSummaryCard[] {
  const { assistantReplies, suggestionCount } = collectAssistantSessionStats(messages);
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
        reviewedSuggestionCount === 0 ? 'Nothing reviewed' : `${reviewedSuggestionCount} reviewed`,
      detail:
        reviewedSuggestionCount === 0
          ? 'Mark suggestions as reviewed once you have checked the underlying settings.'
          : 'Reviewed suggestions stay visible so you can keep the session context intact.',
    },
  ];
}

export function buildAssistantSessionStage(
  messages: AssistantMessageRecord[],
  reviewedSuggestionCount: number,
): AssistantSessionStageSummary {
  const { suggestionCount } = collectAssistantSessionStats(messages);
  if (messages.length === 0) {
    return {
      badge: 'Empty session',
      title: 'Start with a bounded operator audit',
      detail:
        'Ask one concrete question about runtimes, providers, playbooks, integrations, or work items so the assistant can return a reviewable packet instead of vague advice.',
      nextAction: 'Run a quick audit or choose one of the preset asks to start the handoff.',
    };
  }
  if (suggestionCount === 0) {
    return {
      badge: 'Conversation active',
      title: 'Capture the answer, then ask for the next gap',
      detail:
        'The session is still in discovery. Keep the question narrow so follow-up guidance stays tied to one config surface at a time.',
      nextAction:
        'Ask the assistant to name the highest-risk next review surface if you need a tighter handoff.',
    };
  }
  if (reviewedSuggestionCount < suggestionCount) {
    return {
      badge: 'Review needed',
      title: 'Move suggestions into config review',
      detail:
        'The assistant has produced advisory changes. Review the linked settings pages, confirm the current state, then mark each suggestion reviewed to complete the handoff.',
      nextAction: 'Open the suggested config surfaces and resolve the remaining pending items.',
    };
  }
  return {
    badge: 'Ready for handoff',
    title: 'Session context is ready to hand off',
    detail:
      'Every suggestion in this session has been reviewed. Keep the transcript for context, then continue in the destination config pages for any actual changes.',
    nextAction: 'Use the reviewed suggestions below as a launch checklist for the next operator.',
  };
}

export function buildAssistantReviewBuckets(
  messages: AssistantMessageRecord[],
  reviewedSuggestionPaths: ReadonlySet<string>,
): AssistantReviewBucket[] {
  const grouped = new Map<
    string,
    {
      label: string;
      href?: string;
      actionLabel?: string;
      pendingCount: number;
      reviewedCount: number;
    }
  >();

  messages.forEach((message) => {
    message.suggestions?.forEach((suggestion) => {
      const destination = resolveSuggestionDestination(suggestion.path);
      const key = destination?.href ?? `manual:${suggestion.path}`;
      const current = grouped.get(key) ?? {
        label: destination?.label ?? 'Review manually',
        href: destination?.href,
        actionLabel: destination?.label,
        pendingCount: 0,
        reviewedCount: 0,
      };

      if (reviewedSuggestionPaths.has(suggestion.path)) {
        current.reviewedCount += 1;
      } else {
        current.pendingCount += 1;
      }

      grouped.set(key, current);
    });
  });

  return Array.from(grouped.entries())
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      href: bucket.href,
      actionLabel: bucket.actionLabel,
      pendingCount: bucket.pendingCount,
      reviewedCount: bucket.reviewedCount,
      detail:
        bucket.pendingCount > 0
          ? bucket.pendingCount === 1
            ? '1 suggestion still needs review on this surface.'
            : `${bucket.pendingCount} suggestions still need review on this surface.`
          : 'Everything grouped under this surface has been reviewed in the current session.',
    }))
    .sort((left, right) => {
      if (left.pendingCount !== right.pendingCount) {
        return right.pendingCount - left.pendingCount;
      }
      return left.label.localeCompare(right.label);
    });
}

export function resolveSuggestionDestination(path: string): SuggestionDestination | null {
  const normalized = path.toLowerCase();
  if (
    normalized.startsWith('runtime.') ||
    normalized.startsWith('agent.') ||
    normalized.startsWith('global_')
  ) {
    return { href: '/platform/runtimes', label: 'Open runtime defaults' };
  }
  if (
    normalized.startsWith('llm.') ||
    normalized.startsWith('model.') ||
    normalized.startsWith('provider.')
  ) {
    return { href: '/platform/routing', label: 'Open models' };
  }
  if (normalized.startsWith('playbook.') || normalized.startsWith('workflow.')) {
    return { href: '/design/playbooks', label: 'Open playbooks' };
  }
  if (normalized.startsWith('webhook.')) {
    return { href: '/integrations/webhooks', label: 'Open webhooks' };
  }
  if (normalized.startsWith('tool.') || normalized.startsWith('tools.')) {
    return { href: '/platform/tools', label: 'Open tools' };
  }
  if (normalized.startsWith('instruction.') || normalized.startsWith('instructions.')) {
    return { href: '/platform/instructions', label: 'Open instructions' };
  }
  if (normalized.startsWith('trigger.') || normalized.startsWith('work_item_trigger.')) {
    return { href: '/integrations/triggers', label: 'Open work-item triggers' };
  }
  if (normalized.startsWith('role.') || normalized.startsWith('roles.')) {
    return { href: '/design/roles', label: 'Open role definitions' };
  }
  return null;
}

function collectAssistantSessionStats(messages: AssistantMessageRecord[]): {
  assistantReplies: number;
  suggestionCount: number;
} {
  return {
    assistantReplies: messages.filter((message) => message.role === 'assistant').length,
    suggestionCount: messages.reduce(
      (count, message) => count + (message.suggestions?.length ?? 0),
      0,
    ),
  };
}
