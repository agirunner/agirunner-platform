import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_STARTER_PROMPTS,
  buildAssistantReviewBuckets,
  buildAssistantSessionStage,
  resolveSuggestionDestination,
  summarizeAssistantSession,
} from './ai-config-assistant-page.support.js';

describe('ai config assistant support', () => {
  it('provides bounded quick-start prompts for common operator audits', () => {
    expect(ASSISTANT_STARTER_PROMPTS.map((prompt) => prompt.label)).toEqual([
      'Audit agentic settings',
      'Provider posture',
      'Playbook review',
      'Integration hygiene',
      'Tool catalog',
      'Platform instructions',
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
      href: '/admin/agentic-settings',
      label: 'Open agentic settings',
    });
    expect(resolveSuggestionDestination('provider.openai.base_url')).toEqual({
      href: '/platform/routing',
      label: 'Open models',
    });
    expect(resolveSuggestionDestination('integration.github.token')).toBeNull();
    expect(resolveSuggestionDestination('tool.shell_exec')).toEqual({
      href: '/platform/tools',
      label: 'Open tools',
    });
    expect(resolveSuggestionDestination('tools.catalog_posture')).toEqual({
      href: '/platform/tools',
      label: 'Open tools',
    });
    expect(resolveSuggestionDestination('instruction.system_prompt')).toEqual({
      href: '/platform/instructions',
      label: 'Open instructions',
    });
    expect(resolveSuggestionDestination('instructions.role_context')).toEqual({
      href: '/platform/instructions',
      label: 'Open instructions',
    });
    expect(resolveSuggestionDestination('trigger.on_push')).toEqual({
      href: '/integrations/triggers',
      label: 'Open work-item triggers',
    });
    expect(resolveSuggestionDestination('work_item_trigger.on_pr')).toEqual({
      href: '/integrations/triggers',
      label: 'Open work-item triggers',
    });
    expect(resolveSuggestionDestination('role.developer')).toEqual({
      href: '/design/specialists',
      label: 'Open specialists',
    });
    expect(resolveSuggestionDestination('roles.reviewer')).toEqual({
      href: '/design/specialists',
      label: 'Open specialists',
    });
    expect(resolveSuggestionDestination('unknown.path')).toBeNull();
  });

  it('describes empty, review, and handoff stages for the advisory session', () => {
    expect(buildAssistantSessionStage([], 0)).toEqual({
      badge: 'Empty session',
      title: 'Start with a bounded operator audit',
      detail:
        'Ask one concrete question about agentic settings, providers, playbooks, integrations, or work items so the assistant can return a reviewable packet instead of vague advice.',
      nextAction: 'Run a quick audit or choose one of the preset asks to start the handoff.',
    });

    expect(
      buildAssistantSessionStage(
        [
          { id: 1, role: 'user', content: 'Review runtime posture' },
          {
            id: 2,
            role: 'assistant',
            content: 'Review runtime defaults next',
            suggestions: [
              {
                path: 'runtime.default_runtime_image',
                suggested_value: 'agirunner-runtime:stable',
                description: 'Pin the runtime image.',
              },
            ],
          },
        ],
        0,
      ),
    ).toEqual({
      badge: 'Review needed',
      title: 'Move suggestions into config review',
      detail:
        'The assistant has produced advisory changes. Review the linked settings pages, confirm the current state, then mark each suggestion reviewed to complete the handoff.',
      nextAction: 'Open the suggested config surfaces and resolve the remaining pending items.',
    });
  });

  it('groups review queue buckets by destination surface', () => {
    expect(
      buildAssistantReviewBuckets(
        [
          {
            id: 1,
            role: 'assistant',
            content: 'Review runtime and webhook posture',
            suggestions: [
              {
                path: 'runtime.default_runtime_image',
                suggested_value: 'agirunner-runtime:stable',
                description: 'Pin the runtime image.',
              },
              {
                path: 'webhook.delivery_scope',
                suggested_value: 'workflow.failed',
                description: 'Narrow event coverage.',
              },
            ],
          },
        ],
        new Set(['runtime.default_runtime_image']),
      ),
    ).toEqual([
      {
        key: '/integrations/webhooks',
        label: 'Open webhooks',
        href: '/integrations/webhooks',
        actionLabel: 'Open webhooks',
        pendingCount: 1,
        reviewedCount: 0,
        detail: '1 suggestion still needs review on this surface.',
      },
      {
        key: '/admin/agentic-settings',
        label: 'Open agentic settings',
        href: '/admin/agentic-settings',
        actionLabel: 'Open agentic settings',
        pendingCount: 0,
        reviewedCount: 1,
        detail: 'Everything grouped under this surface has been reviewed in the current session.',
      },
    ]);
  });
});
