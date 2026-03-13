import { describe, expect, it } from 'vitest';

import {
  agentDisplayName,
  buildAgentItems,
  describeAgentOption,
  describeSelectedAgent,
  findAgent,
  formatCompactId,
  permissionVariant,
  sortAgents,
  summarizeGrants,
  type OrchestratorGrant,
} from './orchestrator-grants-page.support.js';
import type { DashboardAgentRecord } from '../../lib/api.js';

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

  it('builds sorted bounded agent options and selected-agent packets from live inventory records', () => {
    const agents: DashboardAgentRecord[] = [
      {
        id: 'agent-2',
        name: 'Zeta Runner',
        status: 'inactive',
        worker_id: 'worker-z',
        capabilities: ['review'],
      },
      {
        id: 'agent-1',
        name: 'Alpha Orchestrator',
        status: 'busy',
        worker_id: 'worker-a',
        current_task_id: 'task-9',
        capabilities: ['orchestrator', 'review'],
      },
    ];

    const sorted = sortAgents(agents);
    expect(sorted.map((agent) => agent.id)).toEqual(['agent-1', 'agent-2']);
    expect(agentDisplayName(sorted[0])).toBe('Alpha Orchestrator');
    expect(describeAgentOption(sorted[0])).toContain('busy');
    expect(describeAgentOption(sorted[0])).toContain('worker worker-a');
    expect(describeAgentOption(sorted[0])).toContain('task task-9');

    expect(buildAgentItems(sorted)).toEqual([
      {
        id: 'agent-1',
        label: 'Alpha Orchestrator',
        subtitle: 'busy • worker worker-a • task task-9 • orchestrator, review',
        status: 'pending',
      },
      {
        id: 'agent-2',
        label: 'Zeta Runner',
        subtitle: 'inactive • worker worker-z • review',
        status: 'failed',
      },
    ]);
    expect(findAgent(sorted, 'agent-2')?.name).toBe('Zeta Runner');
    expect(findAgent(sorted, 'missing')).toBeNull();
    expect(describeSelectedAgent(sorted[0])).toEqual([
      { label: 'Status', value: 'busy' },
      { label: 'Worker', value: 'worker-a' },
      { label: 'Current task', value: 'task-9' },
      { label: 'Capabilities', value: 'orchestrator, review' },
    ]);
  });
});
