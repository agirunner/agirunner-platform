import { describe, expect, it } from 'vitest';

import type { DashboardIntegrationRecord } from '../../lib/api.js';
import {
  buildCreateIntegrationPayload,
  buildUpdateIntegrationPayload,
  canSubmitIntegration,
  createHeaderDraft,
  createIntegrationFormState,
  filterIntegrations,
  fieldsForIntegrationKind,
  hydrateIntegrationForm,
  summarizeIntegrationLibrary,
  summarizeIntegrationConfig,
} from './integrations-page.support.js';

describe('integrations page support', () => {
  it('hydrates public integration data into an editable form state', () => {
    expect(
      hydrateIntegrationForm({
        id: 'integration-1',
        kind: 'webhook',
        workflow_id: 'workflow-1',
        subscriptions: ['task.failed'],
        is_active: true,
        config: {
          url: 'https://example.com/hooks',
          secret_configured: true,
          headers: {
            Authorization: 'redacted://integration-header-secret',
            'x-safe': 'true',
          },
        },
      }),
    ).toMatchObject({
      kind: 'webhook',
      workflowId: 'workflow-1',
      subscriptions: ['task.failed'],
      config: {
        url: 'https://example.com/hooks',
        secret: '',
      },
      configuredSecrets: {
        secret: true,
      },
    });
  });

  it('builds create and update payloads with structured header and label state', () => {
    const form = {
      ...createIntegrationFormState('github_issues'),
      subscriptions: ['workflow.failed'],
      config: {
        owner: 'agirunner',
        repo: 'agirunner',
        api_base_url: 'https://github.example/api',
        token: 'secret-token',
      },
      labels: ['bug', 'automation'],
    };

    expect(buildCreateIntegrationPayload(form)).toEqual({
      kind: 'github_issues',
      subscriptions: ['workflow.failed'],
      config: {
        owner: 'agirunner',
        repo: 'agirunner',
        api_base_url: 'https://github.example/api',
        token: 'secret-token',
        labels: ['bug', 'automation'],
      },
    });

    expect(
      buildUpdateIntegrationPayload({
        ...createIntegrationFormState('webhook'),
        config: {
          url: 'https://example.com/hooks',
          secret: '',
        },
        headers: [
          createHeaderDraft('Authorization', '', true),
          createHeaderDraft('x-safe', 'true'),
        ],
      }),
    ).toEqual({
      subscriptions: [],
      config: {
        url: 'https://example.com/hooks',
        headers: {
          Authorization: 'redacted://integration-header-secret',
          'x-safe': 'true',
        },
      },
    });
  });

  it('validates required fields for create and edit flows', () => {
    expect(canSubmitIntegration(createIntegrationFormState('webhook'), 'create')).toBe(false);
    expect(
      canSubmitIntegration(
        {
          ...createIntegrationFormState('slack'),
          configuredSecrets: { webhook_url: true },
        },
        'edit',
      ),
    ).toBe(true);
  });

  it('defines the bounded field catalog for each integration kind', () => {
    expect(fieldsForIntegrationKind('webhook')).toEqual([
      {
        key: 'url',
        label: 'Destination URL',
        type: 'url',
        placeholder: 'https://example.com/hooks',
      },
      {
        key: 'secret',
        label: 'Shared secret',
        type: 'password',
        placeholder: 'Leave blank to keep the stored secret',
      },
    ]);
    expect(fieldsForIntegrationKind('otlp_http')).toEqual([
      {
        key: 'endpoint',
        label: 'Endpoint',
        type: 'url',
        placeholder: 'https://collector.example.com/v1/traces',
      },
      {
        key: 'service_name',
        label: 'Service name',
        type: 'text',
        placeholder: 'agirunner.platform',
      },
    ]);
    expect(fieldsForIntegrationKind('github_issues')).toContainEqual({
      key: 'owner',
      label: 'Repository owner',
      type: 'text',
      placeholder: 'agirunner',
    });
  });

  it('summarizes integration config into operator-facing fact packets', () => {
    expect(
      summarizeIntegrationConfig({
        id: 'integration-1',
        kind: 'github_issues',
        workflow_id: null,
        subscriptions: [],
        is_active: true,
        config: {
          owner: 'agirunner',
          repo: 'agirunner',
          api_base_url: 'https://api.github.com',
          labels: ['bug'],
          token_configured: true,
        },
      }),
    ).toEqual([
      { label: 'Repository', value: 'agirunner/agirunner' },
      { label: 'API base URL', value: 'https://api.github.com' },
      { label: 'Labels', value: 'bug' },
      { label: 'Token', value: 'Configured' },
    ]);
  });

  it('summarizes integration library posture and filters the visible list', () => {
    const integrations: DashboardIntegrationRecord[] = [
      {
        id: 'integration-1',
        kind: 'webhook',
        workflow_id: null,
        subscriptions: ['workflow.failed'],
        is_active: true,
        config: {},
      },
      {
        id: 'integration-2',
        kind: 'slack',
        workflow_id: 'workflow-1',
        subscriptions: ['task.failed'],
        is_active: false,
        config: {},
      },
    ];
    const workflowNameById = new Map([['workflow-1', 'Incident workflow']]);

    expect(summarizeIntegrationLibrary([...integrations])).toEqual([
      {
        label: 'Active destinations',
        value: '1 active',
        detail: '1 integration destination can deliver events right now.',
      },
      {
        label: 'Paused destinations',
        value: '1 paused',
        detail: 'Paused integrations stay configured for review, but they do not deliver outbound events.',
      },
      {
        label: 'Scope coverage',
        value: '1 global / 1 workflow-scoped',
        detail: 'Use scope coverage to confirm whether delivery is shared across all workflows or isolated to specific ones.',
      },
    ]);

    expect(
      filterIntegrations([...integrations], 'incident', 'all', 'workflow', workflowNameById),
    ).toEqual([integrations[1]]);
    expect(
      filterIntegrations([...integrations], '', 'active', 'global', workflowNameById),
    ).toEqual([integrations[0]]);
  });
});
