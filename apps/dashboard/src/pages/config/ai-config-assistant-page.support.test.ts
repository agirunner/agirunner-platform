import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_STARTER_PROMPTS,
  resolveSuggestionDestination,
  summarizeAssistantSession,
} from './ai-config-assistant-page.support.js';

describe('ai config assistant support', () => {
  it('provides bounded quick-start prompts for common operator audits', () => {
    expect(ASSISTANT_STARTER_PROMPTS.map((prompt) => prompt.label)).toEqual([
      'Audit runtimes',
      'Provider posture',
      'Playbook review',
      'Integration hygiene',
    ]);
  });

  it('summarizes conversation posture and advisory review state', () => {
    expect(
      summarizeAssistantSession(
        [
          { id: 1, role: 'user', content: 'Review runtimes' },
          {
            id: 2,
            role: 'assistant',
            content: 'Runtime defaults need attention',
            suggestions: [
              {
                path: 'runtime.default_runtime_image',
                suggested_value: 'agirunner-runtime:stable',
                description: 'Use a pinned runtime image.',
              },
            ],
          },
        ],
        1,
      ),
    ).toEqual([
      {
        label: 'Conversation',
        value: '2 turns',
        detail: '1 assistant response recorded in this session.',
      },
      {
        label: 'Suggestions',
        value: '1 suggestions',
        detail:
          'Suggestions are advisory and should be reviewed in the relevant config surface before applying changes.',
      },
      {
        label: 'Review posture',
        value: '1 reviewed',
        detail: 'Reviewed suggestions stay visible so you can keep the session context intact.',
      },
    ]);
  });

  it('maps known suggestion paths back to concrete config destinations', () => {
    expect(resolveSuggestionDestination('runtime.default_runtime_image')).toEqual({
      href: '/config/runtimes',
      label: 'Open runtime defaults',
    });
    expect(resolveSuggestionDestination('provider.openai.base_url')).toEqual({
      href: '/config/llm',
      label: 'Open LLM settings',
    });
    expect(resolveSuggestionDestination('integration.github.token')).toEqual({
      href: '/config/integrations',
      label: 'Open integrations',
    });
    expect(resolveSuggestionDestination('unknown.path')).toBeNull();
  });
});
