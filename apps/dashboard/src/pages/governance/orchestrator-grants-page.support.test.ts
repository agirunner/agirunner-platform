import { describe, expect, it } from 'vitest';

import {
  formatCompactId,
  permissionVariant,
  summarizeGrants,
  type OrchestratorGrant,
} from './orchestrator-grants-page.support.js';

describe('orchestrator grants support', () => {
  it('summarizes grant coverage and elevated permissions', () => {
    const grants: OrchestratorGrant[] = [
      {
        id: 'grant-1',
        workflow_id: 'workflow-a',
        agent_id: 'agent-1',
        permissions: ['read'],
        created_at: '2026-03-12T00:00:00.000Z',
      },
      {
        id: 'grant-2',
        workflow_id: 'workflow-b',
        agent_id: 'agent-1',
        permissions: ['write'],
        created_at: '2026-03-12T00:00:00.000Z',
      },
      {
        id: 'grant-3',
        workflow_id: 'workflow-b',
        agent_id: 'agent-2',
        permissions: ['execute'],
        created_at: '2026-03-12T00:00:00.000Z',
      },
    ];

    expect(summarizeGrants(grants)).toEqual({
      totalGrants: 3,
      workflowCount: 2,
      agentCount: 2,
      elevatedCount: 2,
    });
  });

  it('formats compact ids and permission badges for operator scanning', () => {
    expect(formatCompactId('12345678abcdefgh')).toBe('12345678…efgh');
    expect(formatCompactId('short-id')).toBe('short-id');
    expect(permissionVariant('read')).toBe('success');
    expect(permissionVariant('write')).toBe('warning');
    expect(permissionVariant('execute')).toBe('destructive');
    expect(permissionVariant('custom')).toBe('secondary');
  });
});
